// 作用：复用库存读取范围提供当前SKU候选。
import { useMemo,useState } from 'react';
import { useEmployeeQuery } from '../employees/use-employee-query';
import { inventoryQueries } from '../services/api';
export function useSkuChoices(){const [keyword,setKeyword]=useState('');const q=useMemo(()=>({page:1,pageSize:100,keyword:keyword||undefined}),[keyword]);const query=useEmployeeQuery(inventoryQueries.skuOptions,JSON.stringify(q),q);return {keyword,setKeyword,query};}
