const { createPage } = require('../../../utils/page-factory')
const { call } = require('../../../utils/api')
const { CLOUD_FUNCTIONS } = require('../../../utils/constants')

function formatDate(value) {
  if (!value) {
    return ''
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function normalizePolicy(item = {}) {
  return {
    ...item,
    displayCreatedAt: formatDate(item.createdAt)
  }
}

Page(createPage({
  data: {
    list: [],
    showModal: false,
    editId: '',
    editTitle: '',
    editContent: '',
    saving: false
  },

  onShow() {
    this.loadList()
  },

  async loadList() {
    try {
      const result = await call(CLOUD_FUNCTIONS.POLICY, 'list', { page: 1, pageSize: 50 })
      this.setData({
        list: ((result && result.list) || []).map(normalizePolicy)
      })
    } catch (err) {
      console.error('[g-policies] load error', err)
    }
  },

  handleAdd() {
    this.setData({
      showModal: true,
      editId: '',
      editTitle: '',
      editContent: ''
    })
  },

  closeModal() {
    this.setData({ showModal: false })
  },

  onTitleInput(event) {
    this.setData({ editTitle: event.detail.value })
  },

  onContentInput(event) {
    this.setData({ editContent: event.detail.value })
  },

  async handleSave() {
    const title = (this.data.editTitle || '').trim()
    const content = (this.data.editContent || '').trim()

    if (!title) {
      wx.showToast({ title: '请输入标题', icon: 'none' })
      return
    }

    this.setData({ saving: true })

    try {
      await call(CLOUD_FUNCTIONS.POLICY, 'create', { title, content })
      wx.showToast({ title: '发布成功', icon: 'none' })
      this.setData({ showModal: false })
      this.loadList()
    } catch (err) {
      wx.showToast({ title: (err && err.msg) || '发布失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  handleDelete(event) {
    const id = event.currentTarget.dataset.id
    const title = event.currentTarget.dataset.title

    wx.showModal({
      title: '删除政策',
      content: `确定删除“${title || '该政策'}”吗？`,
      success: async (res) => {
        if (!res.confirm) {
          return
        }

        try {
          await call(CLOUD_FUNCTIONS.POLICY, 'delete', { _id: id })
          wx.showToast({ title: '已删除', icon: 'none' })
          this.loadList()
        } catch (err) {
          wx.showToast({ title: (err && err.msg) || '删除失败', icon: 'none' })
        }
      }
    })
  }
}))
