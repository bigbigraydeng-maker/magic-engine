import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans:    ['var(--font-sans)',    'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-sans)', 'sans-serif'],
      },
      colors: {
        me: {
          ivory:   '#FBF8F3',
          stone:   '#EAE6DF',
          ochre:   '#C4912E',
          gold:    '#EBCB8B',
          charcoal:'#1A1A1A',
          black:   '#0D0D0D',
          taupe:   '#B7B1A5',
        },
        status: {
          track: '#5C8A4A',
          exec:  '#C4912E',
          attn:  '#8A8276',
          sched: '#3E6E8C',
          rej:   '#C2453A',
        },
      },
      backgroundImage: {
        'gold-gradient': 'linear-gradient(135deg,#EBCB8B,#C4912E 55%,#A6781F)',
        'warm-glow':     'radial-gradient(circle at center, rgba(235,203,139,.55), rgba(235,203,139,.18) 35%, transparent 70%)',
      },
      boxShadow: {
        card: '0 1px 2px rgba(26,26,26,.04), 0 8px 28px rgba(26,26,26,.06)',
      },
      borderRadius: {
        card: '24px',
      },
    },
  },
  plugins: [],
}

export default config
