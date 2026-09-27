import { useMemo } from 'react';
import { motion, useReducedMotion, type Transition } from 'motion/react';
import { cn } from '@/lib/utils';

export interface VerticalCutRevealProps {
  children: string;
  reverse?: boolean;
  transition?: Transition;
  splitBy?: 'words' | 'characters' | 'lines';
  staggerDuration?: number;
  staggerFrom?: 'first' | 'last' | 'center' | 'random' | number;
  containerClassName?: string;
  wordLevelClassName?: string;
  elementLevelClassName?: string;
  reducedMotion?: boolean;
  /** Applies to the moving text, so gradients never paint the clipping mask. */
  styleWord?: (word: string, index: number) => string;
}

interface RevealPart {
  text: string;
  elements: string[];
  offset: number;
  wordIndex: number;
  whitespace: boolean;
}

const spring: Transition = { type: 'spring', stiffness: 200, damping: 21 };
const graphemes = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

function splitCharacters(text: string): string[] {
  return graphemes ? Array.from(graphemes.segment(text), ({ segment }) => segment) : Array.from(text);
}

/** Deterministic shuffle: re-renders and hydration keep the same reveal order. */
function randomOrder(text: string, count: number): number[] {
  let seed = 2166136261;
  for (const character of text) seed = Math.imul(seed ^ character.codePointAt(0)!, 16777619) >>> 0;
  const order = Array.from({ length: count }, (_, index) => index);
  for (let index = count - 1; index > 0; index--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const swapIndex = seed % (index + 1);
    [order[index], order[swapIndex]] = [order[swapIndex], order[index]];
  }
  return order;
}

/** A vertical spring reveal with whole-word wrapping and one accessible text node. */
export function VerticalCutReveal({
  children,
  reverse = false,
  transition = spring,
  splitBy = 'words',
  staggerDuration = 0.2,
  staggerFrom = 'first',
  containerClassName,
  wordLevelClassName,
  elementLevelClassName,
  reducedMotion,
  styleWord,
}: VerticalCutRevealProps) {
  const prefersReducedMotion = useReducedMotion();
  const reduceMotion = reducedMotion ?? prefersReducedMotion ?? false;
  const { parts, total, shuffled } = useMemo(() => {
    const tokens = splitBy === 'lines' ? children.split(/\r?\n/) : (children.match(/\S+|\s+/gu) ?? []);
    let offset = 0;
    let wordIndex = 0;
    const parts: RevealPart[] = tokens.map((text) => {
      const whitespace = splitBy !== 'lines' && /^\s+$/u.test(text);
      const elements = whitespace ? [] : splitBy === 'characters' ? splitCharacters(text) : [text];
      const part = { text, elements, offset, wordIndex, whitespace };
      offset += elements.length;
      if (!whitespace) wordIndex++;
      return part;
    });
    return { parts, total: offset, shuffled: randomOrder(children, offset) };
  }, [children, splitBy]);

  function delayFor(index: number): number {
    let distance: number;
    if (staggerFrom === 'first') distance = index;
    else if (staggerFrom === 'last') distance = total - 1 - index;
    else if (staggerFrom === 'center') distance = Math.abs((total - 1) / 2 - index);
    else if (staggerFrom === 'random') distance = shuffled[index];
    else distance = Math.abs(staggerFrom - index);
    return (transition.delay ?? 0) + distance * Math.max(0, staggerDuration);
  }

  return (
    <span className={cn('flex flex-wrap', splitBy === 'lines' && 'flex-col', containerClassName)}>
      <span className="sr-only">{children}</span>
      {parts.map((part, partIndex) => {
        if (part.whitespace) {
          return part.text.split(/(\r?\n)/).map((space, spaceIndex) =>
            /\n/.test(space) ? (
              <span key={`${partIndex}-${spaceIndex}`} aria-hidden="true" style={{ flexBasis: '100%', height: 0 }} />
            ) : (
              <span key={`${partIndex}-${spaceIndex}`} aria-hidden="true" style={{ whiteSpace: 'pre' }}>
                {space}
              </span>
            ),
          );
        }

        return (
          <span
            key={`${partIndex}-${part.text}`}
            aria-hidden="true"
            className={wordLevelClassName}
            style={{ display: 'inline-flex', whiteSpace: 'pre', flexShrink: 0, minHeight: splitBy === 'lines' ? '1lh' : undefined }}
          >
            {part.elements.map((element, elementIndex) => (
              <span
                key={elementIndex}
                className={elementLevelClassName}
                style={{ display: 'inline-block', overflow: 'hidden', paddingBlock: '0.08em', marginBlock: '-0.08em' }}
              >
                {reduceMotion ? (
                  <span className={styleWord?.(part.text, part.wordIndex)} style={{ display: 'inline-block' }}>
                    {element || '\u00a0'}
                  </span>
                ) : (
                  <motion.span
                    className={styleWord?.(part.text, part.wordIndex)}
                    style={{ display: 'inline-block' }}
                    initial={{ y: reverse ? '-110%' : '110%' }}
                    animate={{ y: 0 }}
                    transition={{ ...transition, delay: delayFor(part.offset + elementIndex) }}
                  >
                    {element || '\u00a0'}
                  </motion.span>
                )}
              </span>
            ))}
          </span>
        );
      })}
    </span>
  );
}
