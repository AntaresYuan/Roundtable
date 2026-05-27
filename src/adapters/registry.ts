import type { AgentAdapter, AgentRoleId } from '../contracts/index.js';

export interface RoleBinding {
  role: AgentRoleId;
  adapterId: string;
}

export class AdapterRegistry {
  private readonly adapters = new Map<string, AgentAdapter>();
  private readonly roleBindings = new Map<AgentRoleId, string>();

  register(adapter: AgentAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`adapter already registered: ${adapter.id}`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  bindRole(role: AgentRoleId, adapterId: string): void {
    if (!this.adapters.has(adapterId)) {
      throw new Error(`cannot bind unknown adapter: ${adapterId}`);
    }
    this.roleBindings.set(role, adapterId);
  }

  resolve(role: AgentRoleId): AgentAdapter {
    const adapterId = this.roleBindings.get(role);
    if (!adapterId) {
      throw new Error(`no adapter bound for role: ${role}`);
    }
    const adapter = this.adapters.get(adapterId);
    if (!adapter) {
      throw new Error(`adapter missing: ${adapterId}`);
    }
    return adapter;
  }

  list(): readonly AgentAdapter[] {
    return Array.from(this.adapters.values());
  }

  bindings(): readonly RoleBinding[] {
    return Array.from(this.roleBindings.entries()).map(([role, adapterId]) => ({
      role,
      adapterId,
    }));
  }
}
