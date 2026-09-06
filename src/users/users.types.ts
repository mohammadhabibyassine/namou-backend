export interface CreateUserData {
  email: string;
  passwordHash: string;
  roleName: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}

export interface UserAuthorization {
  userId: string;
  email: string;
  roleId: string;
  roleName: string;
  permissions: string[];
}

export interface UserAuthentication extends UserAuthorization {
  passwordHash: string;
}
