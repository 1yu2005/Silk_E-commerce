// 商品多图循环展示，保留缩略图选择，并允许暂停自动播放。
import { useEffect, useRef, useState } from 'react';
import { Carousel } from 'antd';
import type { CarouselRef } from 'antd/es/carousel';

const motionQuery = '(prefers-reduced-motion: reduce)';

export function ProductGallery({ name, images }: { name: string; images: string[] }) {
  const carousel = useRef<CarouselRef>(null);
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia(motionQuery).matches);

  useEffect(() => {
    const media = window.matchMedia(motionQuery);
    const update = () => setReducedMotion(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  if (images.length < 2) {
    return <div className="detail-main-image">{images[0] ? <img src={images[0]} alt={name} /> : <span>商品图片准备中</span>}</div>;
  }

  const playing = !paused && !reducedMotion && !hovered && !focused;
  return <section className="product-gallery" aria-label="商品图片" aria-roledescription="轮播"
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
    }}>
    <div className="product-gallery-stage">
      <Carousel ref={carousel} dots={false} infinite draggable autoplay={playing} autoplaySpeed={4000}
        speed={reducedMotion ? 0 : 450} pauseOnHover pauseOnFocus afterChange={setCurrent}>
        {images.map((src, i) => <div key={src}><div className="detail-main-image" role="group" aria-roledescription="幻灯片" aria-label={`第${i + 1}张，共${images.length}张`}>
          <img src={src} alt={`${name}，商品图片${i + 1}`} draggable={false} />
        </div></div>)}
      </Carousel>
      <button type="button" className="product-gallery-arrow product-gallery-prev" aria-label="上一张商品图片" onClick={() => carousel.current?.prev()}>‹</button>
      <button type="button" className="product-gallery-arrow product-gallery-next" aria-label="下一张商品图片" onClick={() => carousel.current?.next()}>›</button>
      <span className="product-gallery-count" aria-live={playing ? 'off' : 'polite'}>{current + 1} / {images.length}</span>
    </div>
    <div className="product-gallery-toolbar">
      <span>商品实拍 · 共 {images.length} 张</span>
      {reducedMotion ? <span>自动播放已关闭</span> : <button type="button" onClick={() => setPaused(value => !value)}>{paused ? '播放轮播' : '暂停轮播'}</button>}
    </div>
    <div className="detail-thumbnails" aria-label="选择商品图片">
      {images.map((src, i) => <button type="button" key={src} aria-label={`查看商品图片${i + 1}`} aria-pressed={current === i} onClick={() => carousel.current?.goTo(i)}>
        <img src={src} alt="" />
      </button>)}
    </div>
  </section>;
}
