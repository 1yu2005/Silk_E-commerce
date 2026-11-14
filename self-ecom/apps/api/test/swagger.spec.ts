// 作用：验证实际 Swagger 路由、认证标记、输入约束及公开响应契约。
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/common/configure-app.js';
import { APP_CONFIG, validateEnvironment } from '../src/config/environment.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AfterSaleCloseFacts } from '../src/after-sales/after-sale-close-facts.js';
import type { OpenAPIObject } from '@nestjs/swagger';

it.each([true, false])('serves native Swagger documents only when enabled=%s', async enabled => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG).useValue(validateEnvironment({ NODE_ENV: 'test', LOG_LEVEL: 'silent',
      DATABASE_URL: 'postgresql://test:test@localhost:15432/shop_test',
      CORS_ORIGINS: 'http://localhost:5173,http://localhost:5174', SWAGGER_ENABLED: String(enabled) }))
    .overrideProvider(AfterSaleCloseFacts).useValue({})
    .overrideProvider(PrismaService).useValue({ ping: async () => {} }).compile();
  const app: INestApplication = module.createNestApplication();
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  try {
    const url = await app.getUrl();
    for (const path of ['/api/docs', '/api/docs-json']) {
      const response = await fetch(`${url}${path}`);
      expect(response.status).toBe(enabled ? 200 : 404);
      expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
      if (!enabled) {
        expect((await response.json() as { code: string }).code).toBe('NOT_FOUND');
      } else if (path.endsWith('-json')) {
        const doc = await response.json() as OpenAPIObject;
        expect(doc.openapi).toMatch(/^3\./);
        expect(doc).not.toHaveProperty('data');
        expect(doc.servers).toEqual([{ url: '/' }]);
        expect(Object.keys(doc.paths).sort()).toEqual(['/api/v1/admin/auth/change-password', '/api/v1/admin/auth/login', '/api/v1/admin/employees', '/api/v1/admin/employees/{id}', '/api/v1/admin/employees/{id}/change-role', '/api/v1/admin/employees/{id}/disable', '/api/v1/admin/employees/{id}/enable', '/api/v1/admin/employees/{id}/extra-permissions', '/api/v1/admin/employees/{id}/profile', '/api/v1/admin/employees/{id}/reset-password', '/api/v1/admin/me', '/api/v1/admin/me/permissions', '/api/v1/admin/permissions', '/api/v1/admin/settings', '/api/v1/admin/settings/versions', '/api/v1/admin/settings/versions/{id}', '/api/v1/admin/tasks', '/api/v1/admin/tasks/summary', '/api/v1/admin/tasks/{id}', '/api/v1/admin/tasks/{id}/claim', '/api/v1/admin/tasks/{id}/extend-deadline', '/api/v1/admin/tasks/{id}/history', '/api/v1/admin/tasks/{id}/release', '/api/v1/admin/tasks/{id}/transfer', '/api/v1/auth/logout', '/api/v1/files', '/api/v1/files/{id}', '/api/v1/files/{id}/content', '/api/v1/health/live', '/api/v1/health/ready', '/api/v1/store/auth/change-password', '/api/v1/store/auth/login', '/api/v1/store/auth/register', '/api/v1/store/contact', '/api/v1/store/me', '/api/v1/store/me/avatar'].concat([
          '/api/v1/admin/categories','/api/v1/admin/categories/tree','/api/v1/admin/categories/{id}','/api/v1/admin/categories/{id}/move',
          '/api/v1/admin/products','/api/v1/admin/products/batch-status','/api/v1/admin/products/{id}','/api/v1/admin/products/{id}/archive',
          '/api/v1/admin/products/{id}/images','/api/v1/admin/products/{id}/initial-inventory-draft','/api/v1/admin/products/{id}/initial-inventory-draft/void',
          '/api/v1/admin/products/{id}/publish','/api/v1/admin/products/{id}/unpublish','/api/v1/admin/products/{id}/sku-combinations/preview',
          '/api/v1/admin/products/{id}/sku-scheme','/api/v1/admin/products/{id}/skus/batch-fill','/api/v1/admin/products/{id}/skus/{skuId}',
          '/api/v1/admin/products/{id}/skus/{skuId}/set-enabled','/api/v1/store/categories','/api/v1/store/products','/api/v1/store/products/{id}',
          '/api/v1/admin/inventory','/api/v1/admin/inventory/ledger','/api/v1/admin/inventory/actions/{id}',
          '/api/v1/admin/inventory/sources','/api/v1/admin/inventory/sources/{id}','/api/v1/admin/inventory/sources/{id}/lines',
          '/api/v1/admin/inventory/source-lines/{id}/verified-quantity','/api/v1/admin/inventory/adjustments',
          '/api/v1/admin/inventory/adjustments/{id}','/api/v1/admin/inventory/adjustments/{id}/claim',
          '/api/v1/admin/inventory/adjustments/{id}/post','/api/v1/admin/inventory/adjustments/{id}/void',
          '/api/v1/admin/inventory/adjustments/{id}/corrections','/api/v1/admin/inventory/adjustments/{id}/resolve-check',
          '/api/v1/admin/inventory/{skuId}','/api/v1/admin/inventory/{skuId}/warning-threshold',
          '/api/v1/admin/products/{id}/initial-inventory-draft/convert',
          '/api/v1/admin/customers','/api/v1/admin/customers/{id}','/api/v1/admin/customers/{id}/addresses',
          '/api/v1/admin/customers/{id}/status-history','/api/v1/admin/customers/{id}/consumption',
          '/api/v1/admin/customers/{id}/restrict-trade','/api/v1/admin/customers/{id}/freeze-login','/api/v1/admin/customers/{id}/restore',
          '/api/v1/store/addresses','/api/v1/store/addresses/{id}','/api/v1/store/addresses/{id}/set-default',
          '/api/v1/store/cart','/api/v1/store/cart/items','/api/v1/store/cart/items/{id}',
          '/api/v1/store/cart/selection','/api/v1/store/cart/items/batch-delete',
          '/api/v1/admin/communications','/api/v1/admin/orders','/api/v1/admin/orders/{id}','/api/v1/admin/orders/{id}/close-unpaid',
          '/api/v1/admin/inventory/stock-incidents','/api/v1/admin/inventory/stock-incidents/candidates/{skuId}',
          '/api/v1/admin/inventory/stock-incidents/{id}','/api/v1/admin/inventory/stock-incidents/{id}/replenishments',
          '/api/v1/admin/inventory/stock-incidents/{id}/resolve','/api/v1/admin/inventory/stock-incidents/{id}/verify',
          '/api/v1/admin/orders/{id}/fulfillment',
          ...['claim','pack','physical-check','prepare','start-handover','confirm-handover','declare-uncertain','resolve-handover','exceptions','tracking','historical-tracking'].map(action=>'/api/v1/admin/orders/{id}/fulfillment/'+action),
          ...['warehouse-ready','customer-choice','resolve'].map(action=>'/api/v1/admin/orders/{id}/fulfillment/exceptions/{exceptionId}/'+action),
          '/api/v1/store/orders/{id}/confirm-receipt',
          '/api/v1/store/checkout/preview','/api/v1/store/orders','/api/v1/store/orders/{id}',
          '/api/v1/store/orders/{id}/cancel','/api/v1/store/orders/{id}/communications','/api/v1/store/orders/{id}/pay',
          ...['store','admin'].flatMap(scope=>['/api/v1/'+scope+'/after-sales','/api/v1/'+scope+'/after-sales/{id}','/api/v1/'+scope+'/after-sales/{id}/history']),
          ...['supplements','withdraw','return-logistics'].map(action=>'/api/v1/store/after-sales/{id}/'+action),
          '/api/v1/store/after-sales/{id}/communications',
          ...['review','return-verifications','close','confirm-no-return-refund'].map(action=>'/api/v1/admin/after-sales/{id}/'+action),
        ]).sort());
        for(const [path,item] of Object.entries(doc.paths))if(/\/admin\/(categories|products|inventory)/.test(path))for(const key of ['get','post','put','patch','delete'] as const){
          const operation=item![key];if(operation)expect(operation.security).toEqual([{bearerAuth:[]}]);
        }
        for(const path of ['/api/v1/store/categories','/api/v1/store/products','/api/v1/store/products/{id}']){
          const operation=doc.paths[path]!.get!;expect(operation.security??[]).toEqual([]);
          expect(JSON.stringify(operation.responses['200'])).not.toMatch(/costCents|reserved|purchaseBlocked|createdById|updatedById/);
        }
        expect(JSON.stringify(doc.paths['/api/v1/admin/products/{id}/sku-scheme']!.put!.responses)).toContain('clientKeyMap');
        expect(JSON.stringify(doc.paths['/api/v1/admin/products']!.post!.requestBody)).not.toMatch(/available|reserved|status/);
        const postInventory=doc.paths['/api/v1/admin/inventory/adjustments/{id}/post']!.post!;
        expect(JSON.stringify(postInventory.requestBody)).not.toMatch(/deltaA|deltaR|available|reserved/);
        expect(postInventory.responses['409']).toMatchObject({content:{'application/json':{schema:{properties:{details:{type:'object',additionalProperties:false}}}}}});
        const settings = doc.paths['/api/v1/admin/settings']!;
        for (const operation of [settings.get!, settings.put!, doc.paths['/api/v1/admin/settings/versions']!.get!,
          doc.paths['/api/v1/admin/settings/versions/{id}']!.get!]) {
          expect(operation.security).toEqual([{ bearerAuth: [] }]);
          for (const status of ['200', '401', '403']) expect(operation.responses).toHaveProperty(status);
        }
        expect(settings.put!.requestBody).toMatchObject({ required: true, content: { 'application/json': { schema: {
          additionalProperties: false, required: ['expectedVersion', 'reason', 'shippingFeeCents', 'freeShippingEnabled',
            'freeShippingThresholdCents', 'returnAddress', 'serviceContact', 'deadlines'], properties: {
            shippingFeeCents: { type: 'integer', minimum: 0, maximum: 1000000 }, freeShippingEnabled: { type: 'boolean' },
            returnAddress: { additionalProperties: false, required: ['receiver', 'phone', 'province', 'city', 'district', 'detail'] },
            deadlines: { additionalProperties: false, properties: { reviewWorkdays: { type: 'integer', minimum: 1, maximum: 30 } } },
          } } } } });
        expect(JSON.stringify(settings.put!.responses['409'])).toContain('VERSION_CONFLICT');
        const contact = doc.paths['/api/v1/store/contact']!.get!;
        expect(contact.security ?? []).toEqual([]); expect(contact.operationId).toBe('getStoreContact');
        expect(JSON.stringify(contact.responses['200'])).not.toMatch(/returnAddress|reason|createdByEmployeeId|deadlines|shippingFee/);
        expect(JSON.stringify(contact.responses['200'])).toContain('servicePhone');
        const live = doc.paths['/api/v1/health/live']!.get!;
        const ready = doc.paths['/api/v1/health/ready']!.get!;
        expect(live.operationId).toBe('getLiveness');
        expect(ready.operationId).toBe('getReadiness');
        expect(ready.tags).toEqual(['Health']);
        expect(ready.responses).toHaveProperty('503');
        expect(JSON.stringify(live.responses)).toContain('X-Request-Id');
        expect(JSON.stringify(live.responses)).toContain('date-time');
        expect(JSON.stringify(live.responses)).toContain('requestId');
        expect(doc.components?.securitySchemes).toEqual({ bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } });
        const upload = doc.paths['/api/v1/files']!.post!;
        expect(upload.security).toEqual([{ bearerAuth: [] }]);
        expect(upload.requestBody).toMatchObject({ content: { 'multipart/form-data': { schema: { required: ['purpose', 'file'],
          additionalProperties: false, properties: { file: { type: 'string', format: 'binary' } } } } } });
        for (const status of ['201', '400', '401', '403', '413', '429']) expect(upload.responses).toHaveProperty(status);
        const content = doc.paths['/api/v1/files/{id}/content']!.get!;
        expect(content.security).toEqual([{ bearerAuth: [] }, {}]);
        expect(content.responses['200']).toMatchObject({ content: { 'image/png': { schema: { type: 'string', format: 'binary' } } } });
        expect(JSON.stringify(upload.responses['201'])).not.toMatch(/storageKey|uploaderCustomerId|sha256|originalName/);
        const login = doc.paths['/api/v1/admin/auth/login']!.post!;
        const me = doc.paths['/api/v1/admin/me']!.get!;
        expect(login.security ?? []).toEqual([]);
        expect(me.security).toEqual([{ bearerAuth: [] }]);
        expect(login.responses).toHaveProperty('429');
        expect(JSON.stringify(login.responses['429'])).toContain('Retry-After');
        expect(JSON.stringify(login.requestBody)).toContain('writeOnly');
        expect(JSON.stringify(login.requestBody)).toContain('password');
        expect(JSON.stringify(login.responses)).not.toContain('passwordHash');
        expect(JSON.stringify(me.responses)).not.toContain('accessToken');
        const change = doc.paths['/api/v1/admin/auth/change-password']!.post!;
        expect(change.security).toEqual([{ bearerAuth: [] }]);
        expect(change.responses).toHaveProperty('400'); expect(change.responses).toHaveProperty('401');
        expect(JSON.stringify(change.requestBody).match(/writeOnly/g)).toHaveLength(2);
        expect(JSON.stringify(change.responses)).toContain('requireLogin');
        expect(JSON.stringify(change.responses)).not.toMatch(/passwordHash|accessToken|oldPassword|newPassword/);
        const logout = doc.paths['/api/v1/auth/logout']!.post!;
        expect(logout.security).toEqual([{ bearerAuth: [] }]);
        expect(logout.requestBody).toMatchObject({ required: false, content: { 'application/json': {
          schema: { type: 'object', additionalProperties: false, maxProperties: 0 },
        } } });
        expect(JSON.stringify(logout.responses)).toContain('loggedOut');
        expect(JSON.stringify(logout.responses)).not.toMatch(/accessToken|passwordHash|sessionId/);
        const permissions = doc.paths['/api/v1/admin/me/permissions']!.get!;
        expect(permissions.security).toEqual([{ bearerAuth: [] }]);
        expect(permissions.responses).toHaveProperty('401'); expect(permissions.responses).toHaveProperty('403');
        expect(JSON.stringify(permissions.responses['403'])).toContain('PASSWORD_CHANGE_REQUIRED');
        for (const field of ['role', 'permissionVersion', 'defaultPermissions', 'extraPermissions', 'effectivePermissions']) {
          expect(JSON.stringify(permissions.responses['200'])).toContain(field);
        }
        expect(JSON.stringify(permissions.responses)).not.toMatch(/passwordHash|accessToken|tokenVersion/);
        const employees = doc.paths['/api/v1/admin/employees']!.get!;
        const detail = doc.paths['/api/v1/admin/employees/{id}']!.get!;
        for (const operation of [employees, detail]) {
          expect(operation.security).toEqual([{ bearerAuth: [] }]);
          for (const status of ['200', '400', '401', '403']) expect(operation.responses).toHaveProperty(status);
          expect(JSON.stringify(operation.responses)).not.toMatch(/passwordHash|accessToken|tokenVersion/);
        }
        expect(detail.responses).toHaveProperty('404');
        expect(employees.parameters?.map(parameter => 'name' in parameter ? parameter.name : '').sort()).toEqual(['keyword', 'page', 'pageSize', 'role', 'status']);
        expect(JSON.stringify(employees.responses['200'])).not.toContain('effectivePermissions');
        expect(JSON.stringify(detail.responses['200'])).toContain('effectivePermissions');
        const create = doc.paths['/api/v1/admin/employees']!.post!;
        expect(create.security).toEqual([{ bearerAuth: [] }]);
        for (const status of ['201', '400', '401', '403', '409']) expect(create.responses).toHaveProperty(status);
        expect(JSON.stringify(create.responses['409'])).toContain('USERNAME_EXISTS');
        expect(JSON.stringify(create.requestBody)).toContain('writeOnly');
        for (const field of ['username', 'displayName', 'role', 'initialPassword', 'reason']) expect(JSON.stringify(create.requestBody)).toContain(field);
        expect(JSON.stringify(create.responses['201'])).not.toMatch(/initialPassword|passwordHash|tokenVersion|accessToken/);
        expect(JSON.stringify(create.responses['201'])).toContain('version');
        const profile = doc.paths['/api/v1/admin/employees/{id}/profile']!.patch!;
        expect(profile.security).toEqual([{ bearerAuth: [] }]);
        for (const status of ['200', '400', '401', '403', '404', '409']) expect(profile.responses).toHaveProperty(status);
        expect(JSON.stringify(profile.responses['404'])).toContain('EMPLOYEE_NOT_FOUND');
        expect(JSON.stringify(profile.responses['409'])).toContain('VERSION_CONFLICT');
        for (const field of ['displayName', 'expectedVersion', 'reason']) expect(JSON.stringify(profile.requestBody)).toContain(field);
        expect(JSON.stringify(profile.requestBody)).not.toMatch(/password|role|status/);
        expect(JSON.stringify(profile.responses['200'])).not.toMatch(/passwordHash|tokenVersion|accessToken/);
        for (const action of ['enable', 'disable']) {
          const status = doc.paths[`/api/v1/admin/employees/{id}/${action}`]!.post!;
          expect(status.security).toEqual([{ bearerAuth: [] }]);
          for (const code of ['200', '400', '401', '403', '404', '409']) expect(status.responses).toHaveProperty(code);
          expect(JSON.stringify(status.responses['409'])).toContain('LAST_ADMIN_REQUIRED');
          expect(JSON.stringify(status.responses['409'])).toContain('VERSION_CONFLICT');
          expect(JSON.stringify(status.responses['200'])).toContain('changed');
          expect(JSON.stringify(status.responses['200'])).not.toMatch(/passwordHash|tokenVersion|accessToken/);
          expect(JSON.stringify(status.requestBody)).not.toMatch(/password|role|status/);
        }
        const reset = doc.paths['/api/v1/admin/employees/{id}/reset-password']!.post!;
        expect(reset.security).toEqual([{ bearerAuth: [] }]);
        for (const status of ['200', '400', '401', '403', '404', '409']) expect(reset.responses).toHaveProperty(status);
        expect(JSON.stringify(reset.responses['400'])).toContain('SELF_PASSWORD_RESET_NOT_ALLOWED');
        expect(JSON.stringify(reset.responses['409'])).toContain('VERSION_CONFLICT');
        for (const field of ['temporaryPassword', 'expectedVersion', 'reason']) expect(JSON.stringify(reset.requestBody)).toContain(field);
        expect(JSON.stringify(reset.requestBody)).toContain('writeOnly');
        expect(JSON.stringify(reset.responses['200'])).toContain('mustChangePassword');
        expect(JSON.stringify(reset.responses)).not.toMatch(/passwordHash|temporaryPassword|tokenVersion|accessToken/);
        const role = doc.paths['/api/v1/admin/employees/{id}/change-role']!.post!;
        expect(role.security).toEqual([{ bearerAuth: [] }]);
        for (const status of ['200', '400', '401', '403', '404', '409']) expect(role.responses).toHaveProperty(status);
        for (const code of ['VERSION_CONFLICT', 'LAST_ADMIN_REQUIRED']) expect(JSON.stringify(role.responses['409'])).toContain(code);
        for (const field of ['role', 'expectedVersion', 'reason']) expect(JSON.stringify(role.requestBody)).toContain(field);
        for (const field of ['role', 'extraPermissions', 'version', 'permissionVersion', 'changed']) expect(JSON.stringify(role.responses['200'])).toContain(field);
        expect(JSON.stringify(role.responses['200'])).not.toMatch(/passwordHash|tokenVersion|accessToken/);
        expect(JSON.stringify(role.requestBody)).not.toMatch(/password|status|extraPermissions/);
        const extra = doc.paths['/api/v1/admin/employees/{id}/extra-permissions']!.put!;
        expect(extra.security).toEqual([{ bearerAuth: [] }]);
        for (const status of ['200', '400', '401', '403', '404', '409']) expect(extra.responses).toHaveProperty(status);
        for (const code of ['PERMISSION_NOT_GRANTABLE', 'EXTRA_PERMISSION_NOT_APPLICABLE']) expect(JSON.stringify(extra.responses['400'])).toContain(code);
        expect(JSON.stringify(extra.responses['409'])).toContain('VERSION_CONFLICT');
        const request = extra.requestBody as { content: { 'application/json': { schema: { required: string[]; additionalProperties: boolean; properties: Record<string, unknown> } } } };
        const schema = request.content['application/json'].schema;
        expect(schema.additionalProperties).toBe(false); expect(schema.required).toEqual(['permissions', 'expectedVersion', 'reason']);
        expect(Object.keys(schema.properties).sort()).toEqual(['expectedVersion', 'permissions', 'reason']);
        expect(schema.properties.permissions).toMatchObject({ type: 'array', maxItems: 200, items: { type: 'string', maxLength: 100 } });
        const extraResponse = extra.responses['200'] as unknown as { content: { 'application/json': { schema: { properties: { data: { required: string[]; additionalProperties: boolean; properties: Record<string, unknown> } } } } } };
        const data = extraResponse.content['application/json'].schema.properties.data;
        const fields = ['addedByDependency', 'changed', 'defaultPermissions', 'effectivePermissions', 'id', 'normalizedDefaultPermissions', 'permissionVersion', 'removedByDependency', 'resolvedExtraPermissions', 'version'];
        expect(data.additionalProperties).toBe(false); expect(Object.keys(data.properties).sort()).toEqual(fields); expect([...data.required].sort()).toEqual(fields);
        for (const field of ['defaultPermissions', 'resolvedExtraPermissions', 'effectivePermissions', 'addedByDependency', 'removedByDependency', 'normalizedDefaultPermissions']) {
          expect(data.properties[field]).toMatchObject({ type: 'array', uniqueItems: true });
        }
        expect(JSON.stringify(extra.responses['200'])).not.toMatch(/passwordHash|tokenVersion|accessToken|grantedById/);
        const catalog = doc.paths['/api/v1/admin/permissions']!.get!;
        expect(catalog.security).toEqual([{ bearerAuth: [] }]);
        expect(catalog.parameters ?? []).toEqual([]); expect(catalog.requestBody).toBeUndefined();
        for (const status of ['200', '401', '403']) expect(catalog.responses).toHaveProperty(status);
        expect(JSON.stringify(catalog.responses['403'])).toContain('PASSWORD_CHANGE_REQUIRED');
        for (const field of ['permissions', 'roleTemplates', 'code', 'name', 'description', 'adminOnly', 'dependencies',
          'SUPER_ADMIN', 'MERCH_WAREHOUSE', 'CUSTOMER_SERVICE']) expect(JSON.stringify(catalog.responses['200'])).toContain(field);
        expect(JSON.stringify(catalog.responses)).not.toMatch(/passwordHash|accessToken|tokenVersion|defaultRole/);
        const register = doc.paths['/api/v1/store/auth/register']!.post!;
        expect(register.security ?? []).toEqual([]); expect(register.operationId).toBe('registerCustomer');
        expect(Object.keys(register.responses).sort()).toEqual(['201', '400', '409', '429']);
        expect(JSON.stringify(register.responses['409'])).toContain('PHONE_EXISTS');
        expect(JSON.stringify(register.responses['429'])).toContain('AUTH_RATE_LIMITED'); expect(JSON.stringify(register.responses['429'])).toContain('Retry-After');
        expect(JSON.stringify(register.responses['201'])).not.toMatch(/password|Hash|accessToken|tokenVersion|phoneVerified|sessionId/);
        const registrationRequest = register.requestBody as { content: { 'application/json': { schema: { additionalProperties: boolean; required: string[]; properties: Record<string, unknown> } } } };
        const registrationSchema = registrationRequest.content['application/json'].schema;
        expect(registrationSchema.additionalProperties).toBe(false); expect(registrationSchema.required).toEqual(['phone', 'password']);
        expect(Object.keys(registrationSchema.properties).sort()).toEqual(['nickname', 'password', 'phone']);
        expect(registrationSchema.properties.password).toMatchObject({ writeOnly: true, format: 'password', minLength: 8, maxLength: 64 });
        expect(registrationSchema.properties.phone).toMatchObject({ pattern: '^1[3-9][0-9]{9}$' });
        expect(registrationSchema.properties.nickname).toMatchObject({ minLength: 1, maxLength: 40 });
        const registrationResponse = register.responses['201'] as unknown as { content: { 'application/json': { schema: { properties: { data: { required: string[]; additionalProperties: boolean; properties: Record<string, unknown> } } } } } };
        const registered = registrationResponse.content['application/json'].schema.properties.data;
        expect(registered.additionalProperties).toBe(false); expect(Object.keys(registered.properties).sort()).toEqual(['createdAt', 'id', 'nickname', 'phone', 'status']);
        expect([...registered.required].sort()).toEqual(['createdAt', 'id', 'nickname', 'phone', 'status']);
        const customerLogin = doc.paths['/api/v1/store/auth/login']!.post!; const customerMe = doc.paths['/api/v1/store/me']!.get!;
        expect(customerLogin.security ?? []).toEqual([]); expect(customerMe.security).toEqual([{ bearerAuth: [] }]);
        expect(Object.keys(customerLogin.responses).sort()).toEqual(['200', '400', '401', '429']); expect(Object.keys(customerMe.responses).sort()).toEqual(['200', '401']);
        expect(customerMe.parameters ?? []).toEqual([]); expect(customerMe.requestBody).toBeUndefined();
        for (const code of ['INVALID_CREDENTIALS', 'ACCOUNT_UNAVAILABLE']) expect(JSON.stringify(customerLogin.responses['401'])).toContain(code);
        for (const code of ['TOKEN_INVALID', 'TOKEN_EXPIRED', 'TOKEN_SUBJECT_MISMATCH', 'SESSION_REVOKED', 'ACCOUNT_UNAVAILABLE']) expect(JSON.stringify(customerMe.responses['401'])).toContain(code);
        expect(JSON.stringify(customerLogin.responses['429'])).toContain('Retry-After'); expect(JSON.stringify(customerLogin.responses['429'])).toContain('AUTH_RATE_LIMITED');
        expect(customerLogin.requestBody).toMatchObject({ content: { 'application/json': { schema: { additionalProperties: false, required: ['phone', 'password'],
          properties: { phone: { pattern: '^1[3-9][0-9]{9}$' }, password: { writeOnly: true, format: 'password' } } } } } });
        const customerMeResponse = customerMe.responses['200'] as unknown as { content: { 'application/json': { schema: { properties: { data: { additionalProperties: boolean; properties: Record<string, unknown> } } } } } };
        const customerData = customerMeResponse.content['application/json'].schema.properties.data;
        const avatar = doc.paths['/api/v1/store/me/avatar']!;
        expect(avatar.delete!.responses['200']).toEqual(avatar.put!.responses['200']);
        expect(customerData.additionalProperties).toBe(false); expect(Object.keys(customerData.properties).sort()).toEqual(['avatarUrl', 'createdAt', 'id', 'nickname', 'phone', 'status']);
        expect(customerData.properties.avatarUrl).toMatchObject({ type: 'string', nullable: true }); expect(customerData.properties.status).toMatchObject({ enum: ['NORMAL', 'TRADE_RESTRICTED'] });
        expect(JSON.stringify(customerMe.responses['200'])).not.toMatch(/password|Hash|accessToken|tokenVersion|effectivePermissions|mustChangePassword/);
        const customerProfile = doc.paths['/api/v1/store/me']!.patch!;
        const customerPassword = doc.paths['/api/v1/store/auth/change-password']!.post!;
        expect(customerProfile.operationId).toBe('updateCustomerMe'); expect(customerPassword.operationId).toBe('changeCustomerPassword');
        for (const operation of [customerProfile, customerPassword]) {
          expect(operation.security).toEqual([{ bearerAuth: [] }]); expect(operation.parameters ?? []).toEqual([]);
          expect(Object.keys(operation.responses).sort()).toEqual(['200', '400', '401']);
          for (const code of ['TOKEN_INVALID', 'TOKEN_EXPIRED', 'TOKEN_SUBJECT_MISMATCH', 'SESSION_REVOKED', 'ACCOUNT_UNAVAILABLE']) expect(JSON.stringify(operation.responses['401'])).toContain(code);
          expect(JSON.stringify(operation.responses['400'])).toContain('VALIDATION_FAILED');
          expect(JSON.stringify(operation.responses['200'])).not.toMatch(/password|Hash|accessToken|tokenVersion|effectivePermissions|mustChangePassword/);
        }
        expect(customerProfile.requestBody).toMatchObject({ content: { 'application/json': { schema: { additionalProperties: false, required: ['nickname'],
          properties: { nickname: { type: 'string', minLength: 1, maxLength: 40 } } } } } });
        expect(customerProfile.responses['200']).toEqual(customerMe.responses['200']);
        expect(customerPassword.requestBody).toEqual(change.requestBody); expect(customerPassword.responses['200']).toEqual(change.responses['200']);
        expect(JSON.stringify(customerPassword.responses['401'])).toContain('INVALID_CREDENTIALS');
      } else {
        expect(response.headers.get('content-type')).toContain('text/html');
        expect(await response.text()).toContain('swagger-ui');
      }
    }
    if (enabled) {
      const asset = await fetch(`${url}/api/docs/swagger-ui-bundle.js`);
      expect(asset.status).toBe(200);
      expect((await asset.text()).length).toBeGreaterThan(1000);
    }
    expect((await fetch(`${url}/api/v1/api/docs`)).status).toBe(404);
    expect((await fetch(`${url}/api/docs-yaml`)).status).toBe(404);
  } finally { await app.close(); }
});
