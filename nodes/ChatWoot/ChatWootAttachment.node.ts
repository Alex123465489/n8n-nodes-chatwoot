import FormData from 'form-data';
import {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	INode,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeApiError,
	NodeOperationError,
} from 'n8n-workflow';

function getHeaderValue(headers: IDataObject, name: string): string | undefined {
	const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
	if (!entry) {
		return undefined;
	}
	const value = entry[1];
	if (Array.isArray(value)) {
		return value[0] as string | undefined;
	}
	if (value === undefined || value === null) {
		return undefined;
	}
	return String(value);
}

function parseContentDispositionFilename(header?: string): string | undefined {
	if (!header) {
		return undefined;
	}
	const match = header.match(/filename\*?=(?:UTF-8''|\")?([^\";]+)/i);
	if (!match) {
		return undefined;
	}
	const raw = match[1];
	try {
		return decodeURIComponent(raw);
	} catch (error) {
		return raw;
	}
}

function fileNameFromUrl(url: string): string | undefined {
	try {
		const parsed = new URL(url);
		const segments = parsed.pathname.split('/').filter(Boolean);
		return segments.pop() || undefined;
	} catch (error) {
		return undefined;
	}
}

function parseJsonField(node: INode, value: unknown, label: string): IDataObject | undefined {
	if (value === undefined || value === null || value === '') {
		return undefined;
	}
	if (typeof value === 'object') {
		return value as IDataObject;
	}
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (!trimmed) {
			return undefined;
		}
		try {
			return JSON.parse(trimmed) as IDataObject;
		} catch (error) {
			throw new NodeOperationError(node, `Cannot parse ${label} as JSON.`);
		}
	}
	throw new NodeOperationError(node, `Unsupported ${label} value type.`);
}

function sanitizeBaseUrl(url: string): string {
	return url.replace(/\/+$/, '');
}

export class ChatWootAttachment implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'ChatWoot Attachment',
		name: 'chatWootAttachment',
		icon: 'file:chatwoot.svg',
		group: ['transform'],
		version: 1,
		subtitle: 'Send attachment from URL',
		description: 'Send ChatWoot message attachments by fetching a public URL.',
		defaults: {
			name: 'ChatWoot Attachment',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'chatwootApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Account ID',
				name: 'accountId',
				type: 'number',
				default: 0,
				required: true,
				description: 'ChatWoot account identifier',
			},
			{
				displayName: 'Conversation ID',
				name: 'conversationId',
				type: 'number',
				default: 0,
				required: true,
				description: 'Target conversation identifier',
			},
			{
				displayName: 'Attachment URL',
				name: 'attachmentUrl',
				type: 'string',
				default: '',
				required: true,
				description: 'Public link to the file that should be sent to ChatWoot',
			},
			{
				displayName: 'File Name',
				name: 'fileName',
				type: 'string',
				default: '',
				description: 'Optional file name override; leave empty to reuse the original name',
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				default: {},
				options: [
					{
						displayName: 'Message Content',
						name: 'content',
						type: 'string',
						default: '',
						description: 'Optional text to send with the attachment',
					},
					{
						displayName: 'Message Type',
						name: 'messageType',
						type: 'options',
					default: 'outgoing',
						options: [
							{ name: 'Incoming', value: 'incoming' },
							{ name: 'Outgoing', value: 'outgoing' },
						],
					},
					{
						displayName: 'Private',
						name: 'private',
						type: 'boolean',
						default: false,
						description: 'Whether to send the attachment as a private note',
					},
					{
						displayName: 'Content Type',
						name: 'contentType',
						type: 'options',
					default: 'cards',
						options: [
							{ name: 'Article', value: 'article' },
							{ name: 'Cards', value: 'cards' },
							{ name: 'Form', value: 'form' },
							{ name: 'Input Email', value: 'input_email' },
							{ name: 'Input Select', value: 'input_select' },
						],
					},
					{
						displayName: 'Content Attributes',
						name: 'contentAttributes',
						type: 'json',
						default: '',
						description: 'JSON string with custom content attributes',
					},
					{
						displayName: 'Template Params',
						name: 'templateParams',
						type: 'json',
						default: '',
						description: 'JSON string with template parameters for WhatsApp flows',
					},
					{
						displayName: 'Attachment MIME Type',
						name: 'attachmentMimeType',
						type: 'string',
						default: '',
						description: 'Override detected MIME type when the source URL does not provide one',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnItems: INodeExecutionData[] = [];
		const node = this.getNode();

		const credentials = (await this.getCredentials('chatwootApi')) as IDataObject;
		if (!credentials.url) {
			throw new NodeOperationError(node, 'ChatWoot API URL is missing in credentials.');
		}
		const baseUrl = sanitizeBaseUrl(String(credentials.url));

		for (let index = 0; index < items.length; index++) {
			try {
				const accountId = this.getNodeParameter('accountId', index) as number;
				const conversationId = this.getNodeParameter('conversationId', index) as number;
				const attachmentUrl = this.getNodeParameter('attachmentUrl', index) as string;
				const fileNameOverride = this.getNodeParameter('fileName', index, '') as string;
				const additionalFields = this.getNodeParameter('additionalFields', index, {}) as IDataObject;

				const downloadOptions: IHttpRequestOptions = {
					method: 'GET',
					url: attachmentUrl,
					encoding: 'arraybuffer',
					returnFullResponse: true,
				};
				const downloadResponse = (await this.helpers.httpRequest(downloadOptions)) as {
					body: ArrayBuffer | Buffer | string;
					headers: IDataObject;
				};

				const rawBody = downloadResponse.body;
				let attachmentBuffer: Buffer;
				if (Buffer.isBuffer(rawBody)) {
					attachmentBuffer = rawBody;
				} else if (typeof rawBody === 'string') {
					attachmentBuffer = Buffer.from(rawBody);
				} else {
					attachmentBuffer = Buffer.from(rawBody);
				}
				const headers = downloadResponse.headers || {};

				const headerFileName = parseContentDispositionFilename(getHeaderValue(headers, 'content-disposition'));
				const derivedFileName = fileNameOverride || headerFileName || fileNameFromUrl(attachmentUrl) || 'attachment';
				const mimeType = (additionalFields.attachmentMimeType as string | undefined)
					|| getHeaderValue(headers, 'content-type')
					|| 'application/octet-stream';

				const form = new FormData();
				form.append('attachments[]', attachmentBuffer, {
					filename: derivedFileName,
					contentType: mimeType,
				});

				if (additionalFields.content !== undefined && additionalFields.content !== '') {
					form.append('content', String(additionalFields.content));
				}
				if (additionalFields.messageType) {
					form.append('message_type', String(additionalFields.messageType));
				}
				if (Object.prototype.hasOwnProperty.call(additionalFields, 'private')) {
					const privateFlag = Boolean(additionalFields.private);
					form.append('private', privateFlag ? 'true' : 'false');
				}
				if (additionalFields.contentType) {
					form.append('content_type', String(additionalFields.contentType));
				}

				const contentAttributes = parseJsonField(node, additionalFields.contentAttributes, 'Content Attributes');
				if (contentAttributes) {
					form.append('content_attributes', JSON.stringify(contentAttributes));
				}
				const templateParams = parseJsonField(node, additionalFields.templateParams, 'Template Params');
				if (templateParams) {
					form.append('template_params', JSON.stringify(templateParams));
				}

				const requestOptions: IHttpRequestOptions = {
					method: 'POST',
					url: `${baseUrl}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`,
					headers: form.getHeaders() as IDataObject,
					body: form,
				};

				const response = await this.helpers.httpRequestWithAuthentication.call(this, 'chatwootApi', requestOptions);

				const responseJson = typeof response === 'string' ? JSON.parse(response) : response;
				returnItems.push({ json: responseJson as IDataObject, pairedItem: { item: index } });
			} catch (error) {
				if (this.continueOnFail()) {
					returnItems.push({ json: { error: (error as Error).message }, pairedItem: { item: index } });
					continue;
				}
				throw new NodeApiError(node, error);
			}
		}

		return [returnItems];
	}
}
