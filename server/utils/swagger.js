/**
 * Swagger/OpenAPI 文档配置，由入口挂载到 /api/docs。
 */

const swaggerJsdoc = require('swagger-jsdoc');

const PORT = process.env.PORT || 3001;

const options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'LabelHub API',
      version: '1.0.0',
      description:
        'LabelHub 数据标注协作平台后端 API。\n\n' +
        '**认证方式**: Bearer Token (HMAC-signed) 或 httpOnly Cookie。\n\n' +
        '**角色**: owner (管理员) | annotator (标注员) | reviewer (审核员)',
      contact: {
        name: 'LabelHub Team',
      },
    },
    servers: [
      {
        url: `http://localhost:${PORT}`,
        description: '本地开发服务器',
      },
    ],
    tags: [
      { name: 'Auth', description: '认证：登录/登出/获取当前用户' },
      { name: 'Users', description: '用户管理（仅 owner）' },
      { name: 'Templates', description: '标注模板 CRUD' },
      { name: 'Tasks', description: '任务管理' },
      { name: 'Annotation Items', description: '标注项：标注/审核/锁定/导入' },
      { name: 'Reviews', description: 'AI 审核结果查询' },
      { name: 'Notifications', description: '通知中心' },
      { name: 'Health', description: '健康检查 / 指标' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'HMAC',
          description: 'HMAC 签名的自定义 Token',
        },
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'token',
          description: 'httpOnly Cookie（XSS 安全）',
        },
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'u001' },
            username: { type: 'string', example: 'annotator' },
            role: { type: 'string', enum: ['owner', 'annotator', 'reviewer'] },
            avatar: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        ApiResponse: {
          type: 'object',
          properties: {
            code: { type: 'integer' },
            message: { type: 'string' },
            data: { type: 'object' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            code: { type: 'integer', example: 400 },
            message: { type: 'string', example: '参数校验失败' },
            data: { type: 'object', nullable: true },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  },
  apis: ['./routes/*.js'],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
