// 定义格式化时间的方法
function dateFormat (daStr) {
    const dt = new Date(daStr)

    const y = dt.getFullYear()
    const m = padZero(dt.getMonth() + 1)
    const d = padZero(dt.getDate())

    const h = dt.getHours()
    const mm = padZero(dt.getMinutes())
    const ss = padZero(dt.getSeconds())
    return `${y}-${m}-${d} ${h}:${mm}:${ss}`
}

// 定义补零的方法
function padZero (n) {
    return n < 10 ? '0' + n : n
}

module.exports = {
    dateFormat
}