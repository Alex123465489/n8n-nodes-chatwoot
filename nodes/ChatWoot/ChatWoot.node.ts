import {INodeProperties, INodePropertyOptions, INodeType, INodeTypeDescription} from 'n8n-workflow';
import {N8NPropertiesBuilder, N8NPropertiesBuilderConfig} from '@devlikeapro/n8n-openapi-node';
import * as doc from './openapi.json';

const config: N8NPropertiesBuilderConfig = {}
const parser = new N8NPropertiesBuilder(doc, config);

function renameOperationByRequestUrl(
    properties: INodeProperties[],
    requestUrl: string,
    newName: string,
    newAction?: string,
) {
    const previousNames: string[] = [];

    properties
        .filter((property) => property.name === 'operation')
        .forEach((property) => {
            const propertyWithOptions = property as INodeProperties & {options?: INodePropertyOptions[]};
            if (!propertyWithOptions.options) {
                return;
            }
            const options = propertyWithOptions.options as INodePropertyOptions[];
            const option = options.find((item) => item.routing?.request?.url === requestUrl);
            if (!option) {
                return;
            }

            const currentName = String(option.name ?? '');
            if (currentName) {
                previousNames.push(currentName);
            }

            option.name = newName;
            option.value = newName;
            if (newAction) {
                option.action = newAction;
            }
        });

    if (previousNames.length === 0) {
        return previousNames;
    }

    properties.forEach((property) => {
        const show = property.displayOptions?.show;
        if (!show?.operation) {
            return;
        }
        show.operation = show.operation.map((operation) => (typeof operation === 'string' && previousNames.includes(operation) ? newName : operation));
    });

    return previousNames;
}

function tweakSwitchFlowFields(properties: INodeProperties[], operationName: string) {
    const fieldMap: Record<string, {displayName: string; description: string}> = {
        conversation_id: {
            displayName: 'Conversation ID',
            description: 'ChatWoot conversation ID that should switch flows',
        },
        flow_id: {
            displayName: 'Flow ID',
            description: 'Identifier of the target n8n flow',
        },
        flow_webhook_url: {
            displayName: 'Flow Webhook URL',
            description: 'Optional override for the flow webhook endpoint',
        },
    };

    properties.forEach((property) => {
        const fieldConfig = fieldMap[property.name as keyof typeof fieldMap];
        if (!fieldConfig) {
            return;
        }
        const show = property.displayOptions?.show;
        if (!show?.operation || !show.operation.includes(operationName)) {
            return;
        }
        property.displayName = fieldConfig.displayName;
        property.description = fieldConfig.description;
    });
}

const properties = parser.build();
const operationNames = renameOperationByRequestUrl(
    properties,
    '=/api/v1/integrations/n8n/switch_flow',
    'Switch Active n8n Flow',
    'Switch active n8n flow',
);
operationNames.forEach((name) => tweakSwitchFlowFields(properties, name));

function tweakAssignConversation(properties: INodeProperties[]) {
    const operationName = 'Assign A Conversation';

    const makeOptionalNumber = (field: INodeProperties | undefined, description: string) => {
        if (!field) {
            return;
        }
        field.displayName = field.displayName?.replace(/Id$/, 'ID') || field.displayName;
        field.description = description;
        field.type = 'string';
        field.default = '';
        if (field.routing?.send) {
            field.routing.send.value = '={{ $value === "" ? undefined : Number($value) }}';
        }
    };

    const assigneeField = properties.find(
        (property) => property.name === 'assignee_id' && property.displayOptions?.show?.operation?.includes(operationName),
    );
    makeOptionalNumber(
        assigneeField,
        'Agent ID to assign the conversation; leave empty to keep the assignment team-based',
    );

    const teamField = properties.find(
        (property) => property.name === 'team_id' && property.displayOptions?.show?.operation?.includes(operationName),
    );
    if (teamField?.routing?.send) {
        teamField.routing.send.type = 'query';
    }
    makeOptionalNumber(
        teamField,
        'Team ID to assign the conversation; leave empty to skip team assignment',
    );
}

tweakAssignConversation(properties);

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
