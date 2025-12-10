// 获取DOM元素
const hourElement = document.getElementById('hour');
const minuteElement = document.getElementById('minute');
const secondElement = document.getElementById('second');
const dateElement = document.getElementById('date');
const amPmElement = document.getElementById('am-pm');

// 更新时钟函数
function updateClock() {
    const now = new Date();
    
    // 获取时、分、秒
    let hours = now.getHours();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    
    // 转换为12小时制
    hours = hours % 12;
    hours = hours ? hours : 12; // 0点显示为12
    
    // 格式化为两位数
    hours = hours < 10 ? '0' + hours : hours;
    minutes = minutes < 10 ? '0' + minutes : minutes;
    seconds = seconds < 10 ? '0' + seconds : seconds;
    
    // 更新DOM元素
    hourElement.textContent = hours;
    minuteElement.textContent = minutes;
    secondElement.textContent = seconds;
    amPmElement.textContent = ampm;
    
    // 更新日期
    const options = { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    };
    dateElement.textContent = now.toLocaleDateString('zh-CN', options);
}

// 初始调用一次
updateClock();

// 每秒更新一次时钟
setInterval(updateClock, 1000);

// 添加一些额外的交互效果
// 鼠标悬停时改变时钟颜色
const clockContainer = document.querySelector('.clock-container');
clockContainer.addEventListener('mouseenter', () => {
    clockContainer.style.transform = 'scale(1.02)';
    clockContainer.style.boxShadow = '0 12px 40px rgba(0, 0, 0, 0.2)';
});

clockContainer.addEventListener('mouseleave', () => {
    clockContainer.style.transform = 'scale(1)';
    clockContainer.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.1)';
});