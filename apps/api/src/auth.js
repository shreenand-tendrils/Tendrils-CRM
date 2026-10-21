
import { ExpressAuth } from '@auth/express';
import Google from '@auth/express/providers/google';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from './db.js';
import { canSignIn, acceptInvitesForEmail, normalizeEmail } from './services/invitations.service.js';

export const authConfig = {
  adapter: PrismaAdapter(prisma),
  trustHost: true,
  secret: process.env.AUTH_SECRET,

  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      // Admins can add/invite someone before their first login. Safe because the signIn callback below only
      // admits Google accounts whose email is VERIFIED by Google and that belong to a member or an open invitation.
      allowDangerousEmailAccountLinking: true,
    }),
  ],

  callbacks: {
    // Access = invitation-based. Any Google account may sign in, but only if its verified email is an active
    // member or holds a usable invitation. Accepting the invitation (membership + teams) happens here.
    async signIn({ user, profile }) {
      const email = normalizeEmail(user?.email || profile?.email);
      const verified = profile?.email_verified === true || profile?.verified_email === true;
      if (!email || !verified) return false;
      if (!(await canSignIn(email))) return `${process.env.WEB_URL || 'http://localhost:5173'}/?authError=not_invited`;
      await acceptInvitesForEmail(email, user?.name || profile?.name);
      return true;
    },

    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }

      return session;
    },

    async redirect({ url, baseUrl }) {
      const webUrl = process.env.WEB_URL || 'http://localhost:5173';

      // Redirect relative URLs to the React frontend.
      if (url.startsWith('/')) {
        return `${webUrl}${url}`;
      }

      // Redirect URLs from the API origin to the frontend.
      try {
        if (new URL(url).origin === baseUrl) {
          return url.replace(baseUrl, webUrl);
        }
      } catch {
        // Invalid URLs fall back to the frontend.
      }

      return webUrl;
    },
  },

  events: {
    // Fill name/photo from Google for people an admin provisioned by email only.
    async signIn({ user, profile }) {
      const data = {};
      if (!user?.name && profile?.name) data.name = profile.name;
      if (!user?.image && profile?.picture) data.image = profile.picture;
      if (user?.id && Object.keys(data).length) await prisma.user.update({ where: { id: user.id }, data }).catch(() => {});
    },
  },

  pages: {
    error: '/?authError=1',
  },
};

export const authHandler = ExpressAuth(authConfig);
