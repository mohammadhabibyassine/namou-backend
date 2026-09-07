import { Prisma } from '../generated/prisma/client.js';

export const USER_PROFILE_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  isActive: true,
  emailVerifiedAt: true,
  createdAt: true,
  updatedAt: true,
  role: {
    select: {
      id: true,
      name: true,
    },
  },
} satisfies Prisma.UserSelect;

export const USER_AUTHORIZATION_SELECT = {
  id: true,
  email: true,
  role: {
    select: {
      id: true,
      name: true,
      permissions: {
        select: {
          permission: {
            select: {
              name: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.UserSelect;

export const USER_AUTHENTICATION_SELECT = {
  ...USER_AUTHORIZATION_SELECT,
  passwordHash: true,
} satisfies Prisma.UserSelect;

export type UserProfile = Prisma.UserGetPayload<{
  select: typeof USER_PROFILE_SELECT;
}>;

export type UserAuthorizationRecord = Prisma.UserGetPayload<{
  select: typeof USER_AUTHORIZATION_SELECT;
}>;

export type UserAuthenticationRecord = Prisma.UserGetPayload<{
  select: typeof USER_AUTHENTICATION_SELECT;
}>;

export const USER_ADDRESS_SELECT = {
  id: true,
  label: true,
  recipientName: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  postalCode: true,
  countryCode: true,
  phone: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserAddressSelect;

export type UserAddressRecord = Prisma.UserAddressGetPayload<{
  select: typeof USER_ADDRESS_SELECT;
}>;
