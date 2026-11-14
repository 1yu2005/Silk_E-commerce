// 北京营业日期固定UTC+8；窗口半开，同一次查询仅读取一次Clock。
export const REPORT_TIME_ZONE='Asia/Shanghai';
export const DASHBOARD_DEFINITION='DASHBOARD_V1';
const DAY=86_400_000,OFFSET=8*60*60*1000;
export function beijingDayStart(now:Date){return new Date(Math.floor((now.getTime()+OFFSET)/DAY)*DAY-OFFSET);}
export function beijingDate(now:Date){return new Date(now.getTime()+OFFSET).toISOString().slice(0,10);}
export function reportRange(now:Date,days:number){
 const today=beijingDayStart(now),from=new Date(today.getTime()-(days-1)*DAY);
 return {from,to:new Date(now),firstDate:beijingDate(from),lastDate:beijingDate(today)};
}
