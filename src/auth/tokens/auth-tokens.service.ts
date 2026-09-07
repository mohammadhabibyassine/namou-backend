import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  authConfig,
  type AuthConfiguration,
} from '../../config/auth.config.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { TokenPair } from '../auth.types.js';
import {
  generateRefreshToken,
  hashRefreshToken,
} from './refresh-token.crypto.js';
import {
  ACCESS_TOKEN_ALGORITHM,
  ACCESS_TOKEN_TYPE,
} from './token.constants.js';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;
const MAX_DEVICE_INFO_LENGTH = 512;

@Injectable()
export class AuthTokensService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    @Inject(authConfig.KEY)
    private readonly config: AuthConfiguration,
  ) {}

  async issueForUser(userId: string, deviceInfo?: string): Promise<TokenPair> {
    const accessToken = await this.signAccessToken(userId);
    const refreshToken = generateRefreshToken();
    const expiresAt = new Date(
      Date.now() + this.config.refreshToken.ttlDays * MILLISECONDS_PER_DAY,
    );

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt,
        deviceInfo: this.normalizeDeviceInfo(deviceInfo),
      },
      select: {
        id: true,
      },
    });

    return this.toTokenPair(accessToken, refreshToken);
  }

  async rotate(
    presentedRefreshToken: string,
    deviceInfo?: string,
  ): Promise<TokenPair | null> {
    const replacementToken = generateRefreshToken();
    const presentedTokenHash = hashRefreshToken(presentedRefreshToken);
    const replacementTokenHash = hashRefreshToken(replacementToken);

    const rotation = await this.prisma.$transaction(async (tx) => {
      const tokenLocation = await tx.refreshToken.findUnique({
        where: {
          tokenHash: presentedTokenHash,
        },
        select: {
          tokenFamilyId: true,
        },
      });

      if (!tokenLocation) {
        return null;
      }

      const familyExists = await this.lockTokenFamily(
        tx,
        tokenLocation.tokenFamilyId,
      );

      if (!familyExists) {
        return null;
      }

      const now = new Date();

      const currentToken = await tx.refreshToken.findUnique({
        where: {
          tokenHash: presentedTokenHash,
        },
        select: {
          id: true,
          userId: true,
          tokenFamilyId: true,
          expiresAt: true,
          revokedAt: true,
          createdAt: true,
          deviceInfo: true,
          user: {
            select: {
              isActive: true,
              deletedAt: true,
            },
          },
        },
      });

      if (!currentToken) {
        return null;
      }

      if (
        currentToken.revokedAt ||
        currentToken.expiresAt <= now ||
        !currentToken.user.isActive ||
        currentToken.user.deletedAt
      ) {
        await this.revokeFamilyInTransaction(
          tx,
          currentToken.tokenFamilyId,
          now,
        );
        return null;
      }

      // This conditional write is the concurrency token. Only one request can
      // move an active refresh token to the revoked state.
      const claimed = await tx.refreshToken.updateMany({
        where: {
          id: currentToken.id,
          revokedAt: null,
          expiresAt: {
            gt: now,
          },
          user: {
            isActive: true,
            deletedAt: null,
          },
        },
        data: {
          revokedAt: new Date(
            Math.max(now.getTime(), currentToken.createdAt.getTime()),
          ),
        },
      });

      if (claimed.count !== 1) {
        await this.revokeFamilyInTransaction(
          tx,
          currentToken.tokenFamilyId,
          now,
        );
        return null;
      }

      const replacement = await tx.refreshToken.create({
        data: {
          userId: currentToken.userId,
          tokenHash: replacementTokenHash,
          tokenFamilyId: currentToken.tokenFamilyId,
          // Preserve the family's absolute lifetime instead of extending it on
          // every rotation.
          expiresAt: currentToken.expiresAt,
          deviceInfo:
            this.normalizeDeviceInfo(deviceInfo) ?? currentToken.deviceInfo,
        },
        select: {
          id: true,
        },
      });

      await tx.refreshToken.update({
        where: {
          id: currentToken.id,
        },
        data: {
          replacedByTokenId: replacement.id,
        },
        select: {
          id: true,
        },
      });

      return {
        userId: currentToken.userId,
      };
    });

    // Throwing inside the transaction would roll back replay-triggered family
    // revocation, so an invalid outcome is handled only after commit.
    if (!rotation) {
      return null;
    }

    const accessToken = await this.signAccessToken(rotation.userId);

    return this.toTokenPair(accessToken, replacementToken);
  }

  async revokeFamily(presentedRefreshToken: string): Promise<void> {
    const tokenHash = hashRefreshToken(presentedRefreshToken);

    await this.prisma.$transaction(async (tx) => {
      const token = await tx.refreshToken.findUnique({
        where: {
          tokenHash,
        },
        select: {
          tokenFamilyId: true,
        },
      });

      if (!token) {
        return;
      }

      const familyExists = await this.lockTokenFamily(tx, token.tokenFamilyId);

      if (!familyExists) {
        return;
      }

      const now = new Date();
      await this.revokeFamilyInTransaction(tx, token.tokenFamilyId, now);
    });
  }

  private signAccessToken(userId: string): Promise<string> {
    return this.jwtService.signAsync(
      {},
      {
        algorithm: ACCESS_TOKEN_ALGORITHM,
        subject: userId,
        jwtid: randomUUID(),
        header: {
          alg: ACCESS_TOKEN_ALGORITHM,
          typ: ACCESS_TOKEN_TYPE,
        },
      },
    );
  }

  private toTokenPair(accessToken: string, refreshToken: string): TokenPair {
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.config.accessToken.ttlSeconds,
    };
  }

  private async revokeFamilyInTransaction(
    tx: Prisma.TransactionClient,
    tokenFamilyId: string,
    proposedRevokedAt: Date,
  ): Promise<void> {
    // A concurrent rotation can create a family member just before this
    // transaction acquires the family lock. Respect the schema's
    // revoked_at >= created_at invariant for every member of the family.
    const latestToken = await tx.refreshToken.aggregate({
      where: {
        tokenFamilyId,
      },
      _max: {
        createdAt: true,
      },
    });
    const revokedAt = new Date(
      Math.max(
        proposedRevokedAt.getTime(),
        latestToken._max.createdAt?.getTime() ?? 0,
      ),
    );

    await tx.refreshToken.updateMany({
      where: {
        tokenFamilyId,
        revokedAt: null,
      },
      data: {
        revokedAt,
      },
    });
  }

  private async lockTokenFamily(
    tx: Prisma.TransactionClient,
    tokenFamilyId: string,
  ): Promise<boolean> {
    // Prisma has no row-lock query API. Every operation locks the oldest token
    // in the family, so refreshes, replays, and logout serialize even when they
    // present different generations from the same family.
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM refresh_tokens
      WHERE token_family_id = ${tokenFamilyId}::uuid
      ORDER BY created_at, id
      LIMIT 1
      FOR UPDATE
    `);

    return rows.length === 1;
  }

  private normalizeDeviceInfo(deviceInfo?: string): string | undefined {
    const normalized = deviceInfo?.trim();

    return normalized ? normalized.slice(0, MAX_DEVICE_INFO_LENGTH) : undefined;
  }
}
