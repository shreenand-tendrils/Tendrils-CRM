import { prisma } from '../db.js';
import * as core from './invitationsCore.js';

export { INVITE_TTL_DAYS, normalizeEmail, inviteExpiry, isInviteUsable, assertTeamsFor, setMembershipTeams, grantMembership } from './invitationsCore.js';
export const acceptInvitesForEmail = (email, name) => core.acceptInvitesForEmail(prisma, email, name);
export const canSignIn = (email) => core.canSignIn(prisma, email);
