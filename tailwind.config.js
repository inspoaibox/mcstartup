/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    './node_modules/@assistant-ui/react-ui/dist/**/*.{js,mjs}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
        },
        // Assistant UI 自定义颜色
        aui: {
          background: 'hsl(var(--aui-background))',
          foreground: 'hsl(var(--aui-foreground))',
          card: 'hsl(var(--aui-card))',
          'card-foreground': 'hsl(var(--aui-card-foreground))',
          primary: 'hsl(var(--aui-primary))',
          'primary-foreground': 'hsl(var(--aui-primary-foreground))',
          secondary: 'hsl(var(--aui-secondary))',
          'secondary-foreground': 'hsl(var(--aui-secondary-foreground))',
          muted: 'hsl(var(--aui-muted))',
          'muted-foreground': 'hsl(var(--aui-muted-foreground))',
          accent: 'hsl(var(--aui-accent))',
          'accent-foreground': 'hsl(var(--aui-accent-foreground))',
          destructive: 'hsl(var(--aui-destructive))',
          'destructive-foreground': 'hsl(var(--aui-destructive-foreground))',
          border: 'hsl(var(--aui-border))',
          input: 'hsl(var(--aui-input))',
          ring: 'hsl(var(--aui-ring))',
          popover: 'hsl(var(--aui-popover))',
          'popover-foreground': 'hsl(var(--aui-popover-foreground))',
        },
      },
      borderRadius: {
        aui: 'var(--aui-radius)',
      },
    },
  },
  plugins: [require('tailwindcss-animate'), require('@tailwindcss/typography')],
  darkMode: 'class',
};
