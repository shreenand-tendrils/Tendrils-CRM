import { workspaceRepository } from '../repositories/workspace.repository.js';

export async function listOrganizations(req, res) {
  res.json(await workspaceRepository.findOrganizationsForUser(req));
}
export async function listRecentActivity(req, res) {
  res.json(await workspaceRepository.findRecentActivity(req, 100));
}
