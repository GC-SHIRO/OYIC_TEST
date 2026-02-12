const cloud = require('wx-server-sdk');
const billingConfig = require('./billingConfig');

cloud.init({
  env: 'cloud1-0g88vkjh890eca50'
});

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openId = wxContext.OPENID;
  const { action } = event;

  try {
    switch (action) {
      case 'overview':
        return await getOverview(openId);
      case 'packs':
        return {
          code: 0,
          message: 'ok',
          data: {
            packs: billingConfig.RECHARGE_PACKS,
            activity: billingConfig.ACTIVITY,
          }
        };
      case 'usage':
        return await getUsageLogs(openId, event);
      case 'shareReward':
        return await applyShareReward(openId);
      default:
        return { code: -1, message: `未知操作: ${action}` };
    }
  } catch (err) {
    console.error('billing 云函数错误:', err);
    return {
      code: -1,
      message: '调用失败',
      error: err.message || String(err)
    };
  }
};

async function getOverview(openId) {
  const user = await getUserByOpenId(openId);
  if (!user) {
    return { code: -1, message: '用户不存在' };
  }

  const todayStart = getStartOfDay(new Date());
  const monthStart = getStartOfMonth(new Date());

  const todayCost = await sumCost(openId, todayStart);
  const monthlyCost = await sumCost(openId, monthStart);

  return {
    code: 0,
    message: 'ok',
    data: {
      balance: user.balance || 0,
      todayCost,
      monthlyCost,
      rechargeRate: billingConfig.RECHARGE_RATE || 0,
      packs: billingConfig.RECHARGE_PACKS,
      activity: billingConfig.ACTIVITY,
    }
  };
}

async function getUsageLogs(openId, event) {
  const { type, limit = 50, skip = 0 } = event || {};
  const query = { _openid: openId };
  if (type && type !== 'all') {
    query.type = type;
  }

  const res = await db.collection('usage_logs')
    .where(query)
    .orderBy('createdAt', 'desc')
    .skip(skip)
    .limit(limit)
    .get();

  const logs = (res.data || []).map((log) => ({
    id: log._id,
    type: log.type,
    delta: log.delta || 0,
    tokens: log.tokens || 0,
    createdAt: normalizeDate(log.createdAt),
    source: log.source || '',
    meta: log.meta || {},
  }));

  return {
    code: 0,
    message: 'ok',
    data: logs
  };
}

async function applyShareReward(openId) {
  const user = await getUserByOpenId(openId);
  if (!user) {
    return { code: -1, message: '用户不存在' };
  }

  const lastShareAt = user.lastShareAt ? new Date(user.lastShareAt) : null;
  if (lastShareAt && isSameDay(lastShareAt, new Date())) {
    return {
      code: 1,
      message: '今日已领取',
      data: { balance: user.balance || 0 }
    };
  }

  const reward = billingConfig.SHARE_DAILY_BONUS;
  const result = await applyBalanceChange(openId, {
    type: 'share',
    delta: reward,
    source: 'system',
  }, {
    lastShareAt: db.serverDate(),
  });

  if (!result.ok) {
    return { code: -1, message: result.message };
  }

  return {
    code: 0,
    message: '领取成功',
    data: { balance: result.balanceAfter }
  };
}

async function getUserByOpenId(openId) {
  const res = await db.collection('users').where({ _openid: openId }).get();
  return res.data && res.data.length > 0 ? res.data[0] : null;
}

async function sumCost(openId, startDate) {
  const res = await db.collection('usage_logs')
    .where({
      _openid: openId,
      createdAt: _.gte(startDate),
      delta: _.lt(0),
    })
    .limit(200)
    .get();

  return (res.data || []).reduce((sum, log) => sum + Math.abs(log.delta || 0), 0);
}

async function applyBalanceChange(openId, change, userPatch) {
  try {
    const result = await db.runTransaction(async (transaction) => {
      const res = await transaction.collection('users').where({ _openid: openId }).get();
      if (!res.data || res.data.length === 0) {
        throw new Error('用户不存在');
      }

      const user = res.data[0];
      const balanceBefore = user.balance || 0;
      const balanceAfter = balanceBefore + change.delta;
      if (balanceAfter < 0) {
        throw new Error('创作点不足');
      }

      await transaction.collection('users').doc(user._id).update({
        data: {
          balance: balanceAfter,
          updatedAt: db.serverDate(),
          ...(userPatch || {})
        }
      });

      await transaction.collection('usage_logs').add({
        data: {
          _openid: openId,
          type: change.type,
          delta: change.delta,
          balanceBefore,
          balanceAfter,
          tokens: change.tokens || 0,
          conversationId: change.conversationId || '',
          cardId: change.cardId || '',
          source: change.source || 'system',
          meta: change.meta || {},
          createdAt: db.serverDate(),
        }
      });

      return { balanceBefore, balanceAfter };
    });

    return { ok: true, balanceBefore: result.balanceBefore, balanceAfter: result.balanceAfter };
  } catch (err) {
    return { ok: false, message: err.message || String(err) };
  }
}

function getStartOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getStartOfMonth(date) {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function normalizeDate(value) {
  if (!value) return Date.now();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (value.$date) return new Date(value.$date).getTime();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  return new Date(value).getTime();
}
