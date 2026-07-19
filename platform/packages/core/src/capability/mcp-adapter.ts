export function mcpActionDescriptors(descriptor: Record<string, unknown>): unknown[] {
  return Array.isArray(descriptor.tools) ? descriptor.tools : [];
}
