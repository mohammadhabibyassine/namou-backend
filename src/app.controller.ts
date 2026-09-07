import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';
import { Public } from './auth/decorators/public.decorator.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @Public()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health/live')
  @Public()
  getLiveness(): { status: 'ok' } {
    return this.appService.getLiveness();
  }

  @Get('health/ready')
  @Public()
  getReadiness(): Promise<{ status: 'ready' }> {
    return this.appService.getReadiness();
  }
}
