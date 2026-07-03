const { createPage } = require('../../../utils/page-factory')
const { call } = require('../../../utils/api')
const { CLOUD_FUNCTIONS, DEFAULT_CATEGORIES } = require('../../../utils/constants')
const { requireCompanyAccess } = require('../../../utils/auth')

Page(createPage({
  data: {
    form: {
      title: '',
      categoryName: '',
      area: '',
      address: '',
      salaryMin: '',
      salaryMax: '',
      workHours: '',
      foodCondition: '',
      peopleCount: '',
      requirement: '',
      description: ''
    },
    categoryIndex: -1,
    categories: DEFAULT_CATEGORIES.map(c => c.name),
    certImages: [],
    certPreview: [],
    uploading: false,
    submitting: false,
    isEdit: false,
    editJobId: null
  },

  onLoad(options = {}) {
    if (!requireCompanyAccess({ message: '请先登录企业账号' })) {
      return
    }

    if (options.jobId) {
      this.setData({ isEdit: true, editJobId: options.jobId })
      this.loadJobDetail(options.jobId)
      wx.setNavigationBarTitle({ title: '编辑岗位' })
    }
  },

  async loadJobDetail(jobId) {
    try {
      const res = await call(CLOUD_FUNCTIONS.COMPANY, 'getMyJobDetail', { jobId })
      if (res) {
        const catIndex = this.data.categories.indexOf(res.categoryName || '')
        this.setData({
          form: {
            title: res.title || '',
            categoryName: res.categoryName || '',
            area: res.area || '',
            address: res.address || '',
            salaryMin: String(res.salaryMin || ''),
            salaryMax: String(res.salaryMax || ''),
            workHours: res.workHours || '',
            foodCondition: res.foodCondition || '',
            peopleCount: String(res.peopleCount || ''),
            requirement: res.requirement || '',
            description: res.description || ''
          },
          categoryIndex: catIndex,
          certImages: res.certImages || [],
          certPreview: res.certImages || []
        })
      }
    } catch (err) {
      console.error('[job-publish] load detail error', err)
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  onTitleInput(e) { this.setData({ 'form.title': e.detail.value }) },
  onAreaInput(e) { this.setData({ 'form.area': e.detail.value }) },
  onAddressInput(e) { this.setData({ 'form.address': e.detail.value }) },
  onSalaryMinInput(e) { this.setData({ 'form.salaryMin': e.detail.value }) },
  onSalaryMaxInput(e) { this.setData({ 'form.salaryMax': e.detail.value }) },
  onWorkHoursInput(e) { this.setData({ 'form.workHours': e.detail.value }) },
  onFoodInput(e) { this.setData({ 'form.foodCondition': e.detail.value }) },
  onPeopleInput(e) { this.setData({ 'form.peopleCount': e.detail.value }) },
  onRequirementInput(e) { this.setData({ 'form.requirement': e.detail.value }) },
  onDescInput(e) { this.setData({ 'form.description': e.detail.value }) },

  onCategoryChange(e) {
    const index = e.detail.value
    const name = this.data.categories[index]
    this.setData({ categoryIndex: index, 'form.categoryName': name })
  },

  async handleChooseImage() {
    if (!requireCompanyAccess({ message: '请先登录企业账号' })) {
      return
    }

    if (this.data.uploading) return

    try {
      const count = 3 - this.data.certImages.length
      if (count <= 0) return

      const res = await wx.chooseImage({
        count: count,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera']
      })
      if (!res.tempFilePaths || res.tempFilePaths.length === 0) return

      // 显示缩略图
      const newPreview = (this.data.certPreview || []).concat(res.tempFilePaths)
      this.setData({ certPreview: newPreview, uploading: true })

      const app = getApp()
      const openid = (app.globalData.accountInfo && app.globalData.accountInfo.openid) || 'unknown'
      const now = Date.now()

      const uploaded = []
      for (let i = 0; i < res.tempFilePaths.length; i++) {
        const path = res.tempFilePaths[i]
        const ext = (path.match(/\.(\w+)$/) || ['', 'jpg'])[1]
        const cloudPath = 'cert/' + openid + '_' + now + '_' + i + '.' + ext

        const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath: path })
        if (uploadRes.fileID) {
          uploaded.push(uploadRes.fileID)
        }
      }

      this.setData({
        certImages: (this.data.certImages || []).concat(uploaded),
        uploading: false
      })
      wx.showToast({ title: '已上传', icon: 'none' })
    } catch (err) {
      console.error('[job-publish] upload error', err)
      wx.showToast({ title: '上传失败', icon: 'none' })
      this.setData({ uploading: false })
    }
  },

  handleRemoveImage(e) {
    const index = e.currentTarget.dataset.index
    const certImages = (this.data.certImages || []).slice()
    const certPreview = (this.data.certPreview || []).slice()
    certImages.splice(index, 1)
    certPreview.splice(index, 1)
    this.setData({ certImages, certPreview })
  },

  handlePreviewImage(e) {
    const urls = this.data.certPreview || []
    if (urls.length === 0) return
    wx.previewImage({
      current: e.currentTarget.dataset.url,
      urls: urls
    })
  },

  async handleSubmit() {
    if (!requireCompanyAccess({ message: '请先登录企业账号' })) {
      return
    }

    if (this.data.submitting || this.data.uploading) return

    const title = (this.data.form.title || '').trim()
    if (!title) {
      wx.showToast({ title: '请填写岗位名称', icon: 'none' })
      return
    }

    this.setData({ submitting: true })

    const payload = {
      title: title,
      categoryName: this.data.form.categoryName || '',
      area: this.data.form.area || '',
      address: this.data.form.address || '',
      salaryMin: Number(this.data.form.salaryMin) || 0,
      salaryMax: Number(this.data.form.salaryMax) || 0,
      workHours: this.data.form.workHours || '',
      foodCondition: this.data.form.foodCondition || '',
      peopleCount: Number(this.data.form.peopleCount) || 0,
      requirement: this.data.form.requirement || '',
      description: this.data.form.description || '',
      certImages: this.data.certImages || []
    }

    try {
      if (this.data.isEdit && this.data.editJobId) {
        await call(CLOUD_FUNCTIONS.COMPANY, 'updateJob', { jobId: this.data.editJobId, ...payload })
        wx.showToast({ title: '已保存，等待重新审核' })
      } else {
        await call(CLOUD_FUNCTIONS.COMPANY, 'createJob', payload)
        wx.showToast({ title: '提交成功，等待管理员审核' })
      }
      setTimeout(() => { wx.navigateBack() }, 1500)
    } catch (err) {
      console.error('[job-publish] submit error', err)
      wx.showToast({ title: (err && err.msg) || '提交失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  }
}))
