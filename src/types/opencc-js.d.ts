declare module 'opencc-js' {
  export interface ConverterOptions {
    from: string;
    to: string;
  }

  export type ConverterFunction = (text: string) => string;

  export function Converter(options: ConverterOptions): ConverterFunction;

  export class CustomConverter {
    constructor(dict: Record<string, string>);
    convert(text: string): string;
  }

  export const Locale: {
    from: {
      cn: string;
      tw: string;
      hk: string;
      jp: string;
    };
    to: {
      cn: string;
      tw: string;
      twp: string;
      hk: string;
      jp: string;
    };
  };
}
