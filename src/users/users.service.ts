import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { normalizeEmail } from '../common/normalizers/email.normalizer.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  getPrismaDatabaseError,
  isPrismaKnownRequestError,
} from '../prisma/prisma-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateAddressDto, UpdateAddressDto } from './dto/address.dto.js';
import type { UpdateProfileDto } from './dto/update-profile.dto.js';
import {
  USER_ADDRESS_SELECT,
  USER_AUTHENTICATION_SELECT,
  USER_AUTHORIZATION_SELECT,
  USER_PROFILE_SELECT,
  type UserAuthenticationRecord,
  type UserAddressRecord,
  type UserAuthorizationRecord,
  type UserProfile,
} from './users.select.js';
import type {
  CreateUserData,
  UserAuthentication,
  UserAuthorization,
} from './users.types.js';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findActiveProfileById(userId: string): Promise<UserProfile | null> {
    return this.prisma.user.findUnique({
      where: {
        id: userId,
        isActive: true,
        deletedAt: null,
      },
      select: USER_PROFILE_SELECT,
    });
  }

  async findActiveAuthorizationById(
    userId: string,
  ): Promise<UserAuthorization | null> {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
        isActive: true,
        deletedAt: null,
      },
      select: USER_AUTHORIZATION_SELECT,
    });

    return user ? this.toAuthorization(user) : null;
  }

  async findActiveAuthenticationByEmail(
    email: string,
  ): Promise<UserAuthentication | null> {
    const user = await this.prisma.user.findUnique({
      where: {
        email: normalizeEmail(email),
        isActive: true,
        deletedAt: null,
      },
      select: USER_AUTHENTICATION_SELECT,
    });

    return user
      ? {
          ...this.toAuthorization(user),
          passwordHash: user.passwordHash,
        }
      : null;
  }

  create(data: CreateUserData): Promise<UserProfile> {
    return this.prisma.user.create({
      data: {
        email: normalizeEmail(data.email),
        passwordHash: data.passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
        role: {
          connect: {
            name: data.roleName,
          },
        },
      },
      select: USER_PROFILE_SELECT,
    });
  }

  async updatePasswordHash(
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    await this.prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        passwordHash,
      },
      select: {
        id: true,
      },
    });
  }

  async updateProfile(
    userId: string,
    input: UpdateProfileDto,
  ): Promise<UserProfile> {
    if (
      input.firstName === undefined &&
      input.lastName === undefined &&
      input.phone === undefined
    ) {
      throw new BadRequestException('At least one profile field is required');
    }
    try {
      return await this.prisma.user.update({
        where: { id: userId, isActive: true, deletedAt: null },
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
        },
        select: USER_PROFILE_SELECT,
      });
    } catch (error: unknown) {
      if (isPrismaKnownRequestError(error, 'P2025')) {
        throw new NotFoundException('User not found');
      }
      throw error;
    }
  }

  findAddresses(userId: string): Promise<UserAddressRecord[]> {
    return this.prisma.userAddress.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: USER_ADDRESS_SELECT,
    });
  }

  async createAddress(
    userId: string,
    input: CreateAddressDto,
  ): Promise<UserAddressRecord> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockActiveUser(tx, userId);
        const activeCount = await tx.userAddress.count({
          where: { userId, deletedAt: null },
        });
        const isDefault = activeCount === 0 || input.isDefault;
        if (isDefault && activeCount > 0) {
          await tx.userAddress.updateMany({
            where: { userId, deletedAt: null, isDefault: true },
            data: { isDefault: false },
          });
        }
        return tx.userAddress.create({
          data: {
            userId,
            label: input.label ?? null,
            recipientName: input.recipientName,
            addressLine1: input.addressLine1,
            addressLine2: input.addressLine2 ?? null,
            city: input.city,
            state: input.state ?? null,
            postalCode: input.postalCode,
            countryCode: input.countryCode,
            phone: input.phone ?? null,
            isDefault,
          },
          select: USER_ADDRESS_SELECT,
        });
      });
    } catch (error: unknown) {
      this.rethrowAddressError(error);
    }
  }

  async updateAddress(
    userId: string,
    addressId: string,
    input: UpdateAddressDto,
  ): Promise<UserAddressRecord> {
    if (Object.values(input).every((value) => value === undefined)) {
      throw new BadRequestException('At least one address field is required');
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockActiveUser(tx, userId);
        const current = await tx.userAddress.findUnique({
          where: { id: addressId, userId, deletedAt: null },
          select: { id: true, isDefault: true },
        });
        if (!current) throw new NotFoundException('Address not found');
        if (current.isDefault && input.isDefault === false) {
          throw new ConflictException(
            'Make another address default instead of unsetting the current default',
          );
        }
        if (input.isDefault === true && !current.isDefault) {
          await tx.userAddress.updateMany({
            where: { userId, deletedAt: null, isDefault: true },
            data: { isDefault: false },
          });
        }
        return tx.userAddress.update({
          where: { id: addressId, userId, deletedAt: null },
          data: this.addressData(input),
          select: USER_ADDRESS_SELECT,
        });
      });
    } catch (error: unknown) {
      this.rethrowAddressError(error);
    }
  }

  async deleteAddress(userId: string, addressId: string): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.lockActiveUser(tx, userId);
        const addresses = await tx.userAddress.findMany({
          where: { userId, deletedAt: null },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, isDefault: true },
        });
        const current = addresses.find(({ id }) => id === addressId);
        if (!current) throw new NotFoundException('Address not found');

        await tx.userAddress.update({
          where: { id: addressId, userId, deletedAt: null },
          data: { deletedAt: new Date(), isDefault: false },
          select: { id: true },
        });
        if (current.isDefault) {
          const replacement = addresses.find(({ id }) => id !== addressId);
          if (replacement) {
            await tx.userAddress.update({
              where: {
                id: replacement.id,
                userId,
                deletedAt: null,
              },
              data: { isDefault: true },
              select: { id: true },
            });
          }
        }
      });
    } catch (error: unknown) {
      this.rethrowAddressError(error);
    }
  }

  private addressData(input: UpdateAddressDto | CreateAddressDto) {
    return {
      label: input.label,
      recipientName: input.recipientName,
      addressLine1: input.addressLine1,
      addressLine2: input.addressLine2,
      city: input.city,
      state: input.state,
      postalCode: input.postalCode,
      countryCode: input.countryCode,
      phone: input.phone,
      isDefault: input.isDefault,
    };
  }

  private async lockActiveUser(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM users
      WHERE id = ${userId}::uuid AND is_active AND deleted_at IS NULL
      FOR UPDATE
    `);
    if (!rows[0]) throw new NotFoundException('User not found');
  }

  private rethrowAddressError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    if (isPrismaKnownRequestError(error, 'P2025')) {
      throw new NotFoundException('Address not found');
    }
    if (isPrismaKnownRequestError(error, 'P2002')) {
      throw new ConflictException('Another address is already the default');
    }
    if (isPrismaKnownRequestError(error, 'P2034')) {
      throw new ConflictException('Concurrent address update; please retry');
    }
    const databaseError = getPrismaDatabaseError(error);
    if (databaseError?.code === '23505') {
      throw new ConflictException('Another address is already the default');
    }
    if (databaseError?.code === 'P0001') {
      throw new ConflictException(
        'A saved address list requires exactly one default',
      );
    }
    throw error;
  }

  private toAuthorization(
    user: UserAuthorizationRecord | UserAuthenticationRecord,
  ): UserAuthorization {
    return {
      userId: user.id,
      email: user.email,
      roleId: user.role.id,
      roleName: user.role.name,
      permissions: user.role.permissions.map(
        ({ permission }) => permission.name,
      ),
    };
  }
}
