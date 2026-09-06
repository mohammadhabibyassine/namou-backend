import type { UserAuthorization } from '../users/users.types.js';

export type AuthenticatedUser = UserAuthorization;

export interface RegisteredUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  role: string;
  createdAt: Date;
}

export interface RegistrationResult {
  user: RegisteredUser;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

export interface LoginContext {
  deviceInfo?: string;
}

export interface LoginResult extends TokenPair {
  user: {
    id: string;
    email: string;
    role: string;
    permissions: string[];
  };
}
