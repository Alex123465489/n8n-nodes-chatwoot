import { ChatWootAttachment } from './ChatWootAttachment.node';

test('attachment node exposes properties', () => {
	const node = new ChatWootAttachment();
	expect(node.description.properties).toBeDefined();
	expect(node.description.properties.length).toBeGreaterThan(0);
});
