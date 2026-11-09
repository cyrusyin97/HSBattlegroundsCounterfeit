import type { Action, GameSnapshot } from './game-api';
import { byId, badge } from './pieces';

type ShopAction = 'refresh' | 'freeze' | 'upgrade';
export function isShopAction(kind: Action['kind']): kind is ShopAction {
  return kind === 'refresh' || kind === 'freeze' || kind === 'upgrade';
}

// Capture the old shop before render replaces it. Kept slots retain their place.
export function departingCards(next: GameSnapshot) {
  const kept = new Set(next.state.me.shop.map(card => String(card.sid)));
  return Array.from(byId('shop').querySelectorAll<HTMLElement>('.piece')).filter(el => !kept.has(el.dataset.slot!)).map(el => {
    const ghost = el.cloneNode(true) as HTMLElement;
    ghost.classList.add('departing');
    ghost.style.left = el.offsetLeft + 'px';
    ghost.style.top = el.offsetTop + 'px';
    ghost.ariaHidden = 'true';
    ghost.inert = true;
    return ghost;
  });
}

export async function playShopEffect(kind: ShopAction, before: GameSnapshot, after: GameSnapshot, outgoing: HTMLElement[]) {
  const row = byId('shop');
  const cards = Array.from(row.querySelectorAll<HTMLElement>('.piece'));
  const animations: Animation[] = [];
  const transient: HTMLElement[] = [];
  function animate(el: HTMLElement, frames: Keyframe[], duration: number, delay = 0) {
    animations.push(el.animate(frames, {duration, delay, fill:'both', easing:'cubic-bezier(.2,.75,.3,1)'}));
  }
  function prop(parent: HTMLElement, cls: string, text = '') {
    const el = badge(cls, text);
    el.ariaHidden = 'true';
    parent.append(el);
    transient.push(el);
    return el;
  }
  const button = byId('tools').querySelector<HTMLElement>(`[data-action="${kind}"]`);
  if (button) animate(button, [{transform:'perspective(450px) translateZ(-18px) rotateX(16deg)'},{transform:'none'}], 340);

  if (kind === 'refresh') {
    for (const [i,ghost] of outgoing.entries()) {
      row.append(ghost); transient.push(ghost);
      animate(ghost, [{opacity:1,transform:'perspective(700px) rotateX(8deg)'}, {opacity:0,transform:'perspective(700px) translate3d(-46px,-42px,-95px) rotateY(-85deg) rotateZ(-12deg)'}], 260, i*30);
    }
    const kept = new Set(before.state.me.shop.map(card=>String(card.sid)));
    cards.filter(el=>!kept.has(el.dataset.slot!)).forEach((el,i)=> {
      animate(el, [
        {opacity:0,transform:'perspective(700px) translate3d(70px,-58px,80px) rotateY(85deg) rotateZ(10deg)',filter:'drop-shadow(12px 32px 12px #58301280)'},
        {opacity:1,transform:'perspective(700px) translateY(4px) rotateX(16deg)',filter:'drop-shadow(0 2px 2px #58301280)',offset:.78},
        {opacity:1,transform:'rotateX(8deg)',filter:'none'},
      ],460,170+i*62);
    });
  } else if (kind === 'freeze') {
    const freezing = after.state.me.frozen;
    const wasFrozen = new Set(before.state.me.shop.filter(slot => slot.frozen).map(slot => String(slot.sid)));
    const wave = prop(row, 'frost-wave');
    animate(wave,[{opacity:0,transform:'scaleX(.08)'},{opacity:.9,offset:.35},{opacity:0,transform:'scaleX(1)'}],650);
    cards.forEach((card,i)=>{
      const shell = card.querySelector<HTMLElement>('.ice-shell');
      if (freezing && shell) {
        animate(shell,[{opacity:0,transform:'perspective(600px) translateZ(70px) scale(1.38) rotateY(35deg)'},{opacity:1,transform:'scale(.96)',offset:.76},{opacity:1,transform:'none'}],440,55*i);
        animate(card,[{transform:'rotateX(8deg)'},{transform:'perspective(700px) translateZ(22px) rotateX(-12deg)',offset:.5},{transform:'rotateX(8deg)'}],400,55*i);
      } else if (!freezing && wasFrozen.has(card.dataset.slot!)) {
        for (const side of [-1,1]) {
          const shard=prop(card,'ice-splinter');
          animate(shard,[{opacity:1},{opacity:0,transform:`perspective(550px) translate3d(${side*50}px,45px,85px) rotateZ(${side*50}deg)`}],460,i*35);
        }
      }
    });
  } else {
    const level = after.state.me.tier;
    const crest=prop(row,'level-crest','★ '+level);
    const ring=prop(row,'level-ring');
    animate(crest,[
      {opacity:0,transform:'perspective(700px) translate3d(0,15px,-100px) rotateX(62deg)'},
      {opacity:1,transform:'perspective(700px) translate3d(0,-16px,90px) rotateX(-9deg)',offset:.30},
      {opacity:1,transform:'translateY(-16px)',offset:.75},
      {opacity:0,transform:'translateY(-54px) scale(.82)'},
    ],980);
    animate(ring,[{opacity:1,transform:'rotateX(66deg) scale(.1)'},{opacity:0,transform:'rotateX(66deg) scale(1.25)'}],760,100);
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      const spark = prop(row, 'level-spark');
      const arc = (radius: number, height: number) =>
        `perspective(650px) translate3d(${Math.cos(angle) * radius}px,${Math.sin(angle) * radius * .32 - height}px,${height}px) rotateZ(${i * 48}deg)`;
      animate(spark, [
        {opacity:0, transform:arc(38, 0)},
        {opacity:1, transform:arc(96, 35), offset:.32},
        {opacity:0, transform:arc(172, -9)},
      ], 460, 155);
    }
    cards.forEach((el,i)=>animate(el,[{transform:'rotateX(8deg)'},{transform:'perspective(750px) translate3d(0,-18px,30px) rotateX(-10deg)',offset:.45},{transform:'rotateX(8deg)'}],410,160+i*28));
  }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) animations.forEach(a=>a.finish());
  try {await Promise.allSettled(animations.map(a=>a.finished));}
  finally {animations.forEach(a=>a.cancel()); transient.forEach(el=>el.remove());}
}
