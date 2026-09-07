import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser } from '../auth.types.js';
import { RequiredPermissionsMetadata } from '../decorators/require-permissions.decorator.js';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Socket.io authorization will use gateway-specific guards and context.
    if (context.getType() !== 'http') {
      return true;
    }

    const requiredPermissions = this.reflector.getAllAndMerge(
      RequiredPermissionsMetadata,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: AuthenticatedUser;
    }>();

    if (!request.user) {
      throw new UnauthorizedException();
    }

    const grantedPermissions = new Set(request.user.permissions);
    const isAuthorized = requiredPermissions.every((permission) =>
      grantedPermissions.has(permission),
    );

    if (!isAuthorized) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
