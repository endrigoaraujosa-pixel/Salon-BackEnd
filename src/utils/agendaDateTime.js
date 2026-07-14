import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';

export const AGENDA_TIME_ZONE = 'America/Recife';

const HAS_EXPLICIT_TIME_ZONE = /[zZ]$|[+-]\d{2}:?\d{2}$/;
const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?/;

export const normalizeAgendaDateTime = (value) => {
  if (!value) return value;

  if (value instanceof Date) {
    return value;
  }

  const rawValue = String(value).trim();

  if (HAS_EXPLICIT_TIME_ZONE.test(rawValue)) {
    return new Date(rawValue);
  }

  const match = rawValue.match(LOCAL_DATE_TIME_PATTERN);

  if (!match) {
    return new Date(rawValue);
  }

  const [, year, month, day, hour, minute, second = '0', millisecond = '0'] = match;
  const agendaDate = new TZDate(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(millisecond.padEnd(3, '0')),
    AGENDA_TIME_ZONE
  );

  return new Date(agendaDate.getTime());
};

export const formatAgendaDate = (value) => format(new TZDate(value, AGENDA_TIME_ZONE), 'yyyy-MM-dd');

export const formatAgendaTime = (value) => format(new TZDate(value, AGENDA_TIME_ZONE), 'HH:mm');

export const formatAgendaDateTime = (value) => format(new TZDate(value, AGENDA_TIME_ZONE), "yyyy-MM-dd'T'HH:mm:ss");


export const buildAgendaDayRange = (date) => ({
  start: normalizeAgendaDateTime(`${date}T00:00:00`),
  end: normalizeAgendaDateTime(`${date}T23:59:59`)
});

export const REMINDER_TYPES = {
  HOURS_24: '24h',
  HOURS_2: '2h',
  HOURS_1: '1h',
  THANK_YOU: 'agradecimento'
};

export const getContextualDayOfWeek = (dateInput, reminderType) => {
  if (!dateInput) return '';

  const diasSemana = [
    'domingo',
    'segunda-feira',
    'terça-feira',
    'quarta-feira',
    'quinta-feira',
    'sexta-feira',
    'sábado'
  ];

  const tzDate = new TZDate(dateInput, AGENDA_TIME_ZONE);
  const dayOfWeek = diasSemana[tzDate.getDay()];

  // Remove sufixos (ex: "24h_enviado_123" -> "24h")
  const coreType = String(reminderType || '').split('_')[0];

  let prefix = '';
  if (coreType === REMINDER_TYPES.HOURS_24) {
    prefix = 'amanhã, ';
  } else if (coreType === REMINDER_TYPES.HOURS_2 || coreType === REMINDER_TYPES.HOURS_1) {
    prefix = 'hoje, ';
  }

  return `${prefix}${dayOfWeek}`;
};

