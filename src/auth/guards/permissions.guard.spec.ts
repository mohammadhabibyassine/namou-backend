import {
  type ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser } from '../auth.types.js';
import {
  Permission,
  type PermissionName,
} from '../authorization/permission.constants.js';
import { RequirePermissions } from '../decorators/require-permissions.decorator.js';
import { PermissionsGuard } from './permissions.guard.js';

@RequirePermissions(Permission.ViewOrders)
class PermissionFixture {
  @RequirePermissions(Permission.ManageOrders)
  manageOrders(): void {}

  inheritedRequirement(): void {}
}

class UnrestrictedFixture {
  unrestricted(): void {}
}

function createContext(
  controller: object,
  handler: () => void,
  permissions?: PermissionName[],
): ExecutionContext {
  const user: AuthenticatedUser | undefined = permissions
    ? {
        userId: 'user-id',
        email: 'customer@example.com',
        roleId: 'role-id',
        roleName: 'customer',
        permissions,
      }
    : undefined;

  return {
    getClass: () => controller.constructor,
    getHandler: () => handler,
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  const guard = new PermissionsGuard(new Reflector());

  it('requires every controller-level and method-level permission', () => {
    const fixture = new PermissionFixture();
    const context = createContext(fixture, fixture.manageOrders, [
      Permission.ViewOrders,
      Permission.ManageOrders,
    ]);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('returns forbidden when an authenticated user lacks a permission', () => {
    const fixture = new PermissionFixture();
    const context = createContext(fixture, fixture.manageOrders, [
      Permission.ViewOrders,
    ]);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('returns unauthorized when authorization metadata exists without a user', () => {
    const fixture = new PermissionFixture();
    const context = createContext(fixture, fixture.inheritedRequirement);

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('allows routes that declare no permission requirements', () => {
    const fixture = new UnrestrictedFixture();
    const context = createContext(fixture, fixture.unrestricted);

    expect(guard.canActivate(context)).toBe(true);
  });
});
