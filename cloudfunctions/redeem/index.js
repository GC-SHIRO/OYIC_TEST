const cloud = require('wx-server-sdk');

cloud.init({
  env: 'cloud1-3g4mpqc0fee87d78'
});

const db = cloud.database();
const _ = db.command;

// 管理员 openId 白名单（首期硬编码，后续可升级）
const ADMIN_OPENIDS = [];

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openId = wxContext.OPENID;
  const { action } = event;

  try {
    switch (action) {
      case 'redeem':
        return await redeemCode(openId, event);
      case 'admin_create':
        return await adminCreate(openId, event);
      case 'admin_list':
        return await adminList(openId, event);
      case 'admin_disable':
        return await adminDisable(openId, event);
      default:
        return { code: -1, message: `未知操作: ${action}` };
    }
  } catch (err) {
    console.error('redeem 云函数错误:', err);
    return {
      code: -1,
      message: '调用失败',
      error: err.message || String(err)
    };
  }
};

// ===================== 用户兑换 =====================

async function redeemCode(openId, event) {
  const code = (event.code || '').trim().toUpperCase();

  if (!code) {
    return { code: -1, message: '请输入兑换码' };
  }

  // 查询兑换码
  const codeRes = await db.collection('redemption_codes')
    .where({ code })
    .limit(1)
    .get();

  if (!codeRes.data || codeRes.data.length === 0) {
    return { code: -1, message: '兑换码不存在' };
  }

  const codeDoc = codeRes.data[0];

  // 校验状态
  if (codeDoc.status !== 'active') {
    return { code: -1, message: '兑换码已失效' };
  }

  // 校验过期
  if (codeDoc.expiresAt) {
    const expireTime = normalizeDate(codeDoc.expiresAt);
    if (Date.now() > expireTime) {
      return { code: -1, message: '兑换码已过期' };
    }
  }

  // 校验该用户已兑换次数是否达到上限
  // perUserLimit: 每人最多可兑换次数，1 = 仅一次，-1 = 不限，N = N次
  const perUserLimit = codeDoc.perUserLimit !== undefined ? codeDoc.perUserLimit : 1;
  const usedByCount = codeDoc.usedByCount || {};
  const userUsedTimes = usedByCount[openId] || 0;
  if (perUserLimit !== -1 && userUsedTimes >= perUserLimit) {
    const limitText = perUserLimit === 1 ? '您已兑换过该兑换码' : `您已达到该兑换码的兑换上限（${perUserLimit}次）`;
    return { code: -1, message: limitText };
  }

  // 校验总使用次数
  if (codeDoc.maxUses !== -1 && codeDoc.usedCount >= codeDoc.maxUses) {
    return { code: -1, message: '兑换码已达使用上限' };
  }

  // 校验每日限量
  if (codeDoc.dailyLimit !== -1) {
    const today = getTodayStr();
    const dailyUsed = codeDoc.dailyResetDate === today ? (codeDoc.dailyUsed || 0) : 0;
    if (dailyUsed >= codeDoc.dailyLimit) {
      return { code: -1, message: '今日兑换名额已满，请明天再试' };
    }
  }

  // 校验指定用户
  if (codeDoc.targetUsers && codeDoc.targetUsers.length > 0) {
    if (!codeDoc.targetUsers.includes(openId)) {
      return { code: -1, message: '该兑换码不适用于您的账号' };
    }
  }

  // 校验新用户专属
  if (codeDoc.newUserOnly) {
    const userRes = await db.collection('users').where({ _openid: openId }).get();
    if (!userRes.data || userRes.data.length === 0) {
      return { code: -1, message: '用户不存在' };
    }
    const user = userRes.data[0];
    const createdAt = normalizeDate(user.createdAt);
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    if (createdAt < sevenDaysAgo) {
      return { code: -1, message: '该兑换码仅限新用户使用' };
    }
  }

  // 根据奖励类型分发处理
  const { rewardType, rewardValue, description } = codeDoc;
  let result;

  if (rewardType === 'points') {
    result = await redeemPoints(openId, codeDoc);
  } else if (rewardType === 'cardTemplate') {
    result = await redeemCardTemplate(openId, codeDoc);
  } else if (rewardType === 'vip') {
    result = await redeemVip(openId, codeDoc);
  } else {
    return { code: -1, message: `不支持的奖励类型: ${rewardType}` };
  }

  if (!result.ok) {
    return { code: -1, message: result.message };
  }

  return {
    code: 0,
    message: '兑换成功',
    data: { rewardType, rewardValue, description }
  };
}

// 兑换创作点
async function redeemPoints(openId, codeDoc) {
  const points = Number(codeDoc.rewardValue) || 0;
  if (points <= 0) return { ok: false, message: '奖励积分配置错误' };

  try {
    await db.runTransaction(async (transaction) => {
      // 更新用户余额
      const userRes = await transaction.collection('users').where({ _openid: openId }).get();
      if (!userRes.data || userRes.data.length === 0) throw new Error('用户不存在');
      const user = userRes.data[0];
      const balanceBefore = user.balance || 0;
      const balanceAfter = balanceBefore + points;

      await transaction.collection('users').doc(user._id).update({
        data: {
          balance: balanceAfter,
          updatedAt: db.serverDate(),
        }
      });

      // 写入账单流水
      await transaction.collection('usage_logs').add({
        data: {
          _openid: openId,
          type: 'redeem',
          delta: points,
          balanceBefore,
          balanceAfter,
          chars: 0,
          source: 'redeem',
          meta: { codeId: codeDoc._id, code: codeDoc.code },
          createdAt: db.serverDate(),
        }
      });

      // 更新兑换码使用记录
      const today = getTodayStr();
      const newDailyUsed = codeDoc.dailyResetDate === today
        ? (codeDoc.dailyUsed || 0) + 1
        : 1;

      const codeUpdate = {
        usedCount: _.inc(1),
        dailyUsed: newDailyUsed,
        dailyResetDate: today,
      };
      // 对该用户的兑换次数 +1（动态字段路径写法）
      codeUpdate[`usedByCount.${openId}`] = _.inc(1);

      await transaction.collection('redemption_codes').doc(codeDoc._id).update({
        data: codeUpdate,
      });
    });

    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message || '兑换失败' };
  }
}

// 兑换角色卡模板
async function redeemCardTemplate(openId, codeDoc) {
  const templateId = codeDoc.rewardValue;
  if (!templateId) return { ok: false, message: '模板配置错误' };

  try {
    const templateRes = await db.collection('characters').doc(templateId).get();
    if (!templateRes.data) return { ok: false, message: '模板不存在' };

    const template = templateRes.data;
    const newCard = {
      ...template,
      _id: undefined,
      _openid: openId,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate(),
    };
    delete newCard._id;

    await db.collection('characters').add({ data: newCard });
    await updateCodeUsage(codeDoc, openId);

    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message || '兑换失败' };
  }
}

// 兑换 VIP
async function redeemVip(openId, codeDoc) {
  const days = Number(codeDoc.rewardValue) || 0;
  if (days <= 0) return { ok: false, message: 'VIP天数配置错误' };

  try {
    const userRes = await db.collection('users').where({ _openid: openId }).get();
    if (!userRes.data || userRes.data.length === 0) return { ok: false, message: '用户不存在' };
    const user = userRes.data[0];

    const now = Date.now();
    const existingExpire = user.vipExpireAt ? normalizeDate(user.vipExpireAt) : now;
    const newExpire = Math.max(existingExpire, now) + days * 24 * 60 * 60 * 1000;

    await db.collection('users').doc(user._id).update({
      data: {
        isVip: true,
        vipExpireAt: new Date(newExpire),
        updatedAt: db.serverDate(),
      }
    });

    await updateCodeUsage(codeDoc, openId);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message || '兑换失败' };
  }
}

// 更新兑换码使用记录（非事务版本，用于 cardTemplate/vip）
async function updateCodeUsage(codeDoc, openId) {
  const today = getTodayStr();
  const newDailyUsed = codeDoc.dailyResetDate === today
    ? (codeDoc.dailyUsed || 0) + 1
    : 1;

  const updateData = {
    usedCount: _.inc(1),
    dailyUsed: newDailyUsed,
    dailyResetDate: today,
  };
  updateData[`usedByCount.${openId}`] = _.inc(1);

  await db.collection('redemption_codes').doc(codeDoc._id).update({
    data: updateData,
  });
}

// ===================== 管理员接口 =====================

function checkAdmin(openId) {
  if (ADMIN_OPENIDS.length > 0 && !ADMIN_OPENIDS.includes(openId)) {
    return false;
  }
  return true;
}

async function adminCreate(openId, event) {
  if (!checkAdmin(openId)) {
    return { code: -1, message: '无权限' };
  }

  const {
    batchId,
    code: customCode,      // 指定兑换码（可选）；不填则随机生成
    count = 1,             // 随机生成时的批量数量，指定 code 时忽略
    rewardType,
    rewardValue,
    maxUses = 1,
    perUserLimit = 1,      // 每人最多可兑换次数：1=一次性，-1=不限，N=N次
    dailyLimit = -1,
    targetUsers = [],
    newUserOnly = false,
    expiresAt = null,
    description = '',
  } = event;

  if (!batchId || !rewardType || rewardValue === undefined) {
    return { code: -1, message: '缺少必要参数：batchId / rewardType / rewardValue' };
  }

  // 构建单条兑换码数据
  const buildCodeData = (codeStr) => ({
    code: codeStr.toUpperCase(),
    rewardType,
    rewardValue,
    maxUses,
    usedCount: 0,
    usedByCount: {},       // 每位用户的兑换次数：{ [openId]: number }
    perUserLimit,          // 每人上限：1=一次性，-1=不限，N=N次
    dailyLimit,
    dailyUsed: 0,
    dailyResetDate: '',
    targetUsers,
    newUserOnly,
    expiresAt: expiresAt ? new Date(expiresAt) : null,
    status: 'active',
    batchId,
    description,
    createdAt: db.serverDate(),
  });

  // ── 模式一：指定自定义兑换码 ──
  if (customCode) {
    const codeStr = customCode.trim().toUpperCase();
    if (!codeStr) {
      return { code: -1, message: 'code 不能为空字符串' };
    }

    // 重复性校验
    const existing = await db.collection('redemption_codes')
      .where({ code: codeStr })
      .limit(1)
      .get();
    if (existing.data && existing.data.length > 0) {
      return { code: -1, message: `兑换码 ${codeStr} 已存在` };
    }

    await db.collection('redemption_codes').add({ data: buildCodeData(codeStr) });

    return {
      code: 0,
      message: '创建成功',
      data: { codes: [codeStr], count: 1 }
    };
  }

  // ── 模式二：随机批量生成 ──
  const generated = [];
  for (let i = 0; i < Math.min(count, 100); i++) {
    const codeStr = generateCode();
    generated.push(codeStr);
    await db.collection('redemption_codes').add({ data: buildCodeData(codeStr) });
  }

  return {
    code: 0,
    message: '创建成功',
    data: { codes: generated, count: generated.length }
  };
}

async function adminList(openId, event) {
  if (!checkAdmin(openId)) {
    return { code: -1, message: '无权限' };
  }

  const { batchId, status, limit = 20, skip = 0 } = event;
  const query = {};
  if (batchId) query.batchId = batchId;
  if (status) query.status = status;

  const res = await db.collection('redemption_codes')
    .where(query)
    .orderBy('createdAt', 'desc')
    .skip(skip)
    .limit(limit)
    .get();

  return {
    code: 0,
    message: 'ok',
    data: res.data || []
  };
}

async function adminDisable(openId, event) {
  if (!checkAdmin(openId)) {
    return { code: -1, message: '无权限' };
  }

  const { code, batchId } = event;

  if (code) {
    await db.collection('redemption_codes')
      .where({ code })
      .update({ data: { status: 'disabled' } });
  } else if (batchId) {
    await db.collection('redemption_codes')
      .where({ batchId })
      .update({ data: { status: 'disabled' } });
  } else {
    return { code: -1, message: '请提供 code 或 batchId' };
  }

  return { code: 0, message: '已禁用' };
}

// ===================== 工具函数 =====================

function generateCode(length = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function normalizeDate(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (value.$date) return new Date(value.$date).getTime();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  return new Date(value).getTime();
}
