import {INodeProperties, INodeType, INodeTypeDescription} from 'n8n-workflow';
import {N8NPropertiesBuilder, N8NPropertiesBuilderConfig} from '@devlikeapro/n8n-openapi-node';
import * as doc from './openapi.json';

const config: N8NPropertiesBuilderConfig = {}
const parser = new N8NPropertiesBuilder(doc, config);

function renameOperation(
    properties: INodeProperties[],
    resource: string,
    requestUrl: string,
    newName: string,
    newAction?: string,
) {
    const operationProperty = properties.find((property) =>
        property.name === 'operation'
        && 'options' in property
        && Array.isArray(property.displayOptions?.show?.resource)
        && property.displayOptions?.show?.resource?.includes(resource),
    ) as (INodeProperties & {options?: Array<Record<string, unknown>>}) | undefined;

    if (!operationProperty?.options) {
        return;
    }

    const option = operationProperty.options.find((item) => (item as {routing?: {request?: {url?: string}}}).routing?.request?.url === requestUrl) as
        | (Record<string, unknown> & {name?: string; value?: string; action?: string})
        | undefined;
    if (!option) {
        return;
    }

    const previousName = option.name as string | undefined;
    option.name = newName;
    option.value = newName;
    if (newAction) {
        option.action = newAction;
    }

    properties.forEach((property) => {
        const show = property.displayOptions?.show;
        if (!show?.resource || !show?.operation) {
            return;
        }
        if (show.resource.includes(resource) && previousName) {
            show.operation = show.operation.map((operation) => (operation === previousName ? newName : operation));
        }
    });
}

const properties = parser.build();
renameOperation(
    properties,
    'Integrations',
    '=/api/v1/integrations/n8n/switch_flow',
    'Switch Active n8n Flow',
    'Switch active n8n flow',
);

export class ChatWoot implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'ChatWoot',
        name: 'chatWoot',
        icon: 'file:chatwoot.svg',
        group: ['transform'],
        version: 1,
        subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
        description: 'Interact with ChatWoot API',
        defaults: {
            name: 'ChatWoot',
        },
        inputs: ['main'],
        outputs: ['main'],
        credentials: [
            {
                name: 'chatwootApi',
                required: true,
            },
        ],
        requestDefaults: {
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            baseURL: '={{$credentials.url}}',
        },
        properties: properties,
    };
}
