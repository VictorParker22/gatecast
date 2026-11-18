// The launch video for The Stacks: 1920x1080, 30 frames a second, about 27 seconds, no sound.
// Every picture is a real screenshot of library.html (see ../../README.md for how they were taken), the typefaces are
// the site's own, and every sentence is one the site already says or a fact from data/books.json.
import {Gradient, Img, Rect, Txt, makeScene2D} from '@motion-canvas/2d';
import {Reference, all, createRef, easeInOutCubic, easeOutCubic, linear, waitFor} from '@motion-canvas/core';

import room from '../../../../assets/stacks/room-desktop-2560.webp';
import back from '../images/back.jpg';
import book from '../images/book.jpg';
import card from '../images/card.png';
import hero from '../images/hero.jpg';
import note from '../images/note.png';

// The room's colours (styles/main.css, --color-lib-*).
const NIGHT = '#0C0A09';
const CREAM = '#EDE3C8';
const BRASS_1 = '#EED48C';
const BRASS_2 = '#C49A45';
const BRASS_3 = '#8C6A2A';

const SLAB = 'Alfa Slab One';
const SIGN = 'Barlow Condensed';
const TEXT = 'Inter';

const brass = (half: number) =>
  new Gradient({type: 'linear', from: [0, -half], to: [0, half], stops: [{offset: 0, color: BRASS_1}, {offset: 0.55, color: BRASS_2}, {offset: 1, color: BRASS_3}]});

export default makeScene2D(function* (view) {
  view.fill(NIGHT);
  // The site's typefaces must be ready before the first frame is drawn.
  yield Promise.all([
    document.fonts.load(`400 96px "${SLAB}"`),
    document.fonts.load(`800 40px "${SIGN}"`),
    document.fonts.load(`600 40px "${TEXT}"`),
    document.fonts.load(`italic 500 40px "${TEXT}"`),
  ]);

  const roomImg = createRef<Img>();
  const heroImg = createRef<Img>();
  const bookImg = createRef<Img>();
  const backImg = createRef<Img>();
  const dim = createRef<Rect>();
  const noteImg = createRef<Img>();
  const cardImg = createRef<Img>();
  const caption = createRef<Rect>();
  const captionText = createRef<Txt>();
  const fadeOut = createRef<Rect>();

  view.add(
    <>
      <Img ref={roomImg} src={room} width={1920} scale={1.16} opacity={0} />
      <Img ref={heroImg} src={hero} width={1920} opacity={0} />
      <Img ref={bookImg} src={book} width={1920} opacity={0} />
      <Img ref={backImg} src={back} width={1920} opacity={0} />
      <Rect ref={dim} width={1920} height={1080} fill={NIGHT} opacity={0} />
      <Img ref={noteImg} src={note} width={349} x={-124} y={118} opacity={0} radius={4} shadowColor={'#000000CC'} shadowBlur={60} shadowOffsetY={20} />
      <Img ref={cardImg} src={card} width={760} x={450} y={30} rotation={2} opacity={0} shadowColor={'#000000CC'} shadowBlur={70} shadowOffsetY={24} />
      <Rect ref={caption} layout padding={[20, 40]} radius={12} fill={'#0C0A09F0'} stroke={BRASS_2} lineWidth={2} y={372} opacity={0}>
        <Txt ref={captionText} fontFamily={TEXT} fontWeight={600} fontSize={40} fill={CREAM} text={''} />
      </Rect>
    </>,
  );

  // Pictures load on their own time: wait for each before anything reads its size.
  for (const img of [roomImg, heroImg, bookImg, backImg, noteImg, cardImg]) yield img();

  // One caption at a time, low in the picture but clear of the page's own buttons.
  function* say(text: string, hold: number) {
    captionText().text(text);
    caption().y(392);
    yield* all(caption().opacity(1, 0.4), caption().y(372, 0.4, easeOutCubic));
    yield* waitFor(hold);
    yield* caption().opacity(0, 0.3);
  }
  const line = (ref: Reference<Txt>, text: string, y: number, size: number, fill: string | Gradient, family = SLAB, weight = 400) => (
    <Txt ref={ref} text={text} y={y} fontFamily={family} fontWeight={weight} fontSize={size} fill={fill} opacity={0} />
  );
  function* rise(ref: Reference<Txt>, time = 0.7) {
    const y = ref().y();
    ref().y(y + 24);
    yield* all(ref().opacity(1, time), ref().y(y, time, easeOutCubic));
  }

  /* 1. The hook, over the dark room (0 to 4.6 s) */
  const brand = createRef<Txt>();
  const hook1 = createRef<Txt>();
  const hook2 = createRef<Txt>();
  view.add(
    <>
      <Txt ref={brand} text={'GATECAST'} y={-150} fontFamily={SIGN} fontWeight={800} fontSize={40} letterSpacing={14} fill={BRASS_2} opacity={0} />
      {line(hook1, 'Some stories are true.', -30, 104, CREAM)}
      {line(hook2, 'Some only say they are.', 100, 104, brass(52))}
    </>,
  );
  yield roomImg().scale(1.04, 30, linear); // a slow push in, under everything, for the whole film
  yield* roomImg().opacity(0.3, 0.8);
  yield* brand().opacity(1, 0.4);
  yield* rise(hook1);
  yield* waitFor(0.7);
  yield* rise(hook2);
  yield* waitFor(1.3);
  yield* all(brand().opacity(0, 0.4), hook1().opacity(0, 0.4), hook2().opacity(0, 0.4));

  /* 2. The library itself (to 9.8 s) */
  heroImg().scale(1.07);
  yield heroImg().scale(1, 5.4, linear);
  yield* heroImg().opacity(1, 0.8);
  yield* waitFor(0.5);
  yield* say('The Stacks: 78 books on eight shelves, picked by our editor.', 3.2);

  /* 3. Pull a book out, turn it over (to 15.2 s) */
  yield bookImg().scale(1.05, 5.6, linear);
  yield* bookImg().opacity(1, 0.6);
  heroImg().opacity(0);
  yield* say('Pull a book out.', 1.4);
  backImg().scale(1.02);
  yield* backImg().opacity(1, 0.6);
  bookImg().opacity(0);
  yield* say('Turn it over for what it’s about, in our own words.', 2.2);

  /* 4. Worth knowing: the note lifts off the page (to 20.4 s) */
  const truth = createRef<Txt>();
  view.add(line(truth, 'Where a true story bends the truth, we say so.', -300, 60, CREAM));
  yield* noteImg().opacity(1, 0.2);
  yield* all(
    dim().opacity(0.9, 0.8),
    noteImg().position([0, 40], 0.8, easeInOutCubic),
    noteImg().width(1180, 0.8, easeInOutCubic),
  );
  yield* rise(truth, 0.5);
  yield* waitFor(3.2);
  yield* all(noteImg().opacity(0, 0.4), truth().opacity(0, 0.4));

  /* 5. The library card (to 24.6 s) */
  const borrow1 = createRef<Txt>();
  const borrow2 = createRef<Txt>();
  const borrow3 = createRef<Txt>();
  view.add(
    <>
      {line(borrow1, 'Borrow a book.', -110, 68, CREAM)}
      {line(borrow2, 'Your card gets stamped.', -10, 68, brass(34))}
      {line(borrow3, 'No account. Kept on your device only.', 110, 38, CREAM, TEXT, 500)}
    </>,
  );
  for (const t of [borrow1, borrow2, borrow3]) t().x(-470);
  backImg().opacity(0);
  cardImg().scale(0.94);
  yield* all(cardImg().opacity(1, 0.5), cardImg().scale(1, 0.6, easeOutCubic));
  yield* rise(borrow1, 0.45);
  yield* rise(borrow2, 0.45);
  yield* rise(borrow3, 0.45);
  yield* waitFor(1.9);
  yield* all(cardImg().opacity(0, 0.4), borrow1().opacity(0, 0.4), borrow2().opacity(0, 0.4), borrow3().opacity(0, 0.4));

  /* 6. The end card (to about 27 s) */
  const title = createRef<Txt>();
  const open = createRef<Txt>();
  const url = createRef<Txt>();
  const maker = createRef<Txt>();
  view.add(
    <>
      {line(title, 'The Stacks', -110, 190, brass(95))}
      {line(open, 'Open all night.', 40, 50, CREAM, TEXT, 500)}
      <Txt ref={url} text={'WWW.THEGATECAST.COM'} y={170} fontFamily={SIGN} fontWeight={800} fontSize={46} letterSpacing={8} fill={BRASS_1} opacity={0} />
      <Txt ref={maker} text={'Made by ORYNTLabs LLC'} y={440} fontFamily={TEXT} fontWeight={500} fontSize={26} fill={CREAM} opacity={0} />
      <Rect ref={fadeOut} width={1920} height={1080} fill={NIGHT} opacity={0} />
    </>,
  );
  open().fontStyle('italic');
  yield* dim().opacity(0.55, 0.5);
  yield* rise(title, 0.7);
  yield* rise(open, 0.5);
  yield* all(url().opacity(1, 0.5), maker().opacity(0.75, 0.5));
  yield* waitFor(2.2);
  yield* fadeOut().opacity(1, 0.6);
  yield* waitFor(0.2);
});
