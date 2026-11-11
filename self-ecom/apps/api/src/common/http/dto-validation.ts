import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

export class DtoValidationException extends BadRequestException {
  constructor(readonly details: { field: string; message: string }[]) {
    super('请求参数不合法');
  }
}

const messages: Record<string, string> = {
  whitelistValidation: '不允许提交此字段',
  isDefined: '此字段必填',
  isString: '必须为字符串',
  isNotEmpty: '不能为空',
  isInt: '必须为整数',
  min: '低于允许的最小值',
  max: '超过允许的最大值',
  isBoolean: '必须为布尔值true或false',
};

function detailsOf(errors: ValidationError[], parent = ''): { field: string; message: string }[] {
  return errors.flatMap(error => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    return [
      ...Object.keys(error.constraints ?? {}).map(rule => ({
        field, message: messages[rule] ?? '字段不符合校验规则',
      })),
      ...detailsOf(error.children ?? [], field),
    ];
  });
}

export function createValidationPipe() {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    validationError: { target: false, value: false },
    // 使用固定提示，避免校验器在错误信息中插入用户输入。
    exceptionFactory: errors => new DtoValidationException(detailsOf(errors)),
  });
}
