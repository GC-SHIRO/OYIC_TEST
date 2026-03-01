// 云函数入口文件 - 更新用户信息
const cloud = require('wx-server-sdk')

cloud.init({
  env: 'cloud1-3g4mpqc0fee87d78'
})

const db = cloud.database()

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openId = wxContext.OPENID

  try {
    const updateData = {}

    // 只更新传入的字段
    if (event.nickname !== undefined) {
      updateData.nickname = event.nickname
    }
    if (event.avatar !== undefined) {
      updateData.avatar = event.avatar
    }
    if (event.signature !== undefined) {
      updateData.signature = event.signature
    }

    updateData.updatedAt = db.serverDate()

    const res = await db.collection('users').where({
      _openid: openId
    }).update({
      data: updateData
    })

    return {
      code: 0,
      message: '更新成功',
      data: {
        updated: res.stats.updated
      }
    }
  } catch (err) {
    console.error('更新用户信息失败', err)
    return {
      code: -1,
      message: '更新失败',
      error: err.message || String(err)
    }
  }
}
