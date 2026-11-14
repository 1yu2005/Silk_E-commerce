// 作用：库存409可能已提交核实待办，必须读取最新登记/任务后重试，沿用公共防重复与会话保护。
import { useCatalogCommand } from '../catalog/use-catalog-command';
export function useInventoryCommand(saved:()=>void){return useCatalogCommand(saved,{blockConflicts:true});}
