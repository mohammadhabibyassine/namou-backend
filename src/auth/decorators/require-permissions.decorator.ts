import { Reflector } from '@nestjs/core';
import type { PermissionName } from '../authorization/permission.constants.js';

export const RequiredPermissionsMetadata =
  Reflector.createDecorator<readonly PermissionName[]>();

export function RequirePermissions(
  ...permissions: PermissionName[]
): MethodDecorator & ClassDecorator {
  return RequiredPermissionsMetadata(permissions);
}
