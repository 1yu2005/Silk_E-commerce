// 详情页共用的内容分区和页内导航，锚点跳转保留已填写的表单。
import type { ReactNode } from 'react';

export function DetailSection({id,title,description,children}:{id:string;title:string;description?:string;children:ReactNode}) {
  return <section id={id} className="detail-section" aria-labelledby={id+'-title'}>
    <header className="detail-section-heading"><h2 id={id+'-title'}>{title}</h2>{description?<p>{description}</p>:null}</header>
    {children}
  </section>;
}

export function DetailNav({items}:{items:{id:string;label:string}[]}) {
  return <nav className="detail-section-nav" aria-label="详情页板块导航">
    {items.map(item=><a href={'#'+item.id} key={item.id}>{item.label}</a>)}
  </nav>;
}
