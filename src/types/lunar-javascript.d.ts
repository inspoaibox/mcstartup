declare module 'lunar-javascript' {
  class Solar {
    static fromDate(date: Date): Solar;
    static fromYmd(year: number, month: number, day: number): Solar;
    getYear(): number;
    getMonth(): number;
    getDay(): number;
    getWeek(): number;
    getFestivals(): string[];
    getLunar(): Lunar;
  }

  class Lunar {
    getYearInChinese(): string;
    getMonthInChinese(): string;
    getDayInChinese(): string;
    getYearInGanZhi(): string;
    getMonthInGanZhi(): string;
    getDayInGanZhi(): string;
    getYearShengXiao(): string;
    getJieQi(): string;
    getFestivals(): string[];
    getDayYi(): string[];
    getDayJi(): string[];
  }

  class HolidayUtil {
    static getHoliday(year: number, month: number, day: number): Holiday | null;
  }

  class Holiday {
    getName(): string;
    isWork(): boolean;
  }
}
