/** Zod 请求参数校验中间件，失败时返回统一的字段错误结构。 */
const { z } = require('zod');

/**
 * 创建校验中间件：按 source 提取数据并校验。
 * @param {z.ZodType} schema - Zod 校验规则
 * @param {'body'|'query'|'params'} source - 数据来源
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const data = req[source];
    const result = schema.safeParse(data);

    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }));

      return res.status(400).json({
        code: 400,
        message: '参数校验失败',
        data: { errors },
      });
    }

    // 使用经过转换并填充默认值的数据继续处理。
    req[source] = result.data;
    next();
  };
}

function body(schema) {
  return validate(schema, 'body');
}

function query(schema) {
  return validate(schema, 'query');
}

function params(schema) {
  return validate(schema, 'params');
}

module.exports = { validate, body, query, params, z };
