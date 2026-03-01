const cloud = require('wx-server-sdk');

cloud.init({
  env: 'cloud1-3g4mpqc0fee87d78'
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openId = wxContext.OPENID;
  const { action, characterId } = event;

  try {
    switch (action) {
      case 'get':
        return await getConversation(openId, characterId);
      case 'delete':
        return await deleteConversation(openId, characterId);
      default:
        return { code: -1, message: `未知操作: ${action}` };
    }
  } catch (err) {
    console.error('conversation 云函数错误:', err);
    return { code: -1, message: '调用失败', error: err.message || String(err) };
  }
};

async function getConversation(openId, characterId) {
  if (!characterId) return { code: -1, message: '缺少 characterId' };

  const res = await db.collection('conversations').where({
    _openid: openId,
    characterId,
  }).get();

  let record = res.data && res.data.length > 0 ? res.data[0] : null;

  if (!record) {
    const legacyRes = await db.collection('conversations')
      .where({ characterId })
      .orderBy('updatedAt', 'desc')
      .limit(1)
      .get();
    record = legacyRes.data && legacyRes.data.length > 0 ? legacyRes.data[0] : null;

    if (record && record._id) {
      await db.collection('conversations').doc(record._id).update({
        data: { _openid: openId }
      });
    }
  }

  return {
    code: 0,
    message: 'ok',
    data: {
      messages: record?.messages || [],
    }
  };
}

async function deleteConversation(openId, characterId) {
  if (!characterId) return { code: -1, message: '缺少 characterId' };

  await db.collection('conversations').where({
    _openid: openId,
    characterId,
  }).remove();

  await db.collection('conversations').where({
    characterId,
  }).remove();

  return { code: 0, message: 'ok' };
}
