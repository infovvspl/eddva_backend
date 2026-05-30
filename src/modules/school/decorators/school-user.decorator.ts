import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const SchoolUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().user,
);
