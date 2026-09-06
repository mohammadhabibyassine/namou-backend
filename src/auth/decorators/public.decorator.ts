import { Reflector } from '@nestjs/core';

export const PublicMetadata = Reflector.createDecorator<boolean>();

export function Public(): MethodDecorator & ClassDecorator {
  return PublicMetadata(true);
}
