export type CnpjData = {
  cnpj: string
  razao_social: string
  nome_fantasia: string | null
  email: string | null
  telefone: string | null
}

export type CepData = {
  cep: string
  logradouro: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
}

function onlyDigits(v: string) {
  return v.replace(/\D/g, '')
}

export function formatCpf(v: string) {
  const d = onlyDigits(v).slice(0, 11)
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2')
}

export function formatCnpj(v: string) {
  const d = onlyDigits(v).slice(0, 14)
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}

export function formatCep(v: string) {
  const d = onlyDigits(v).slice(0, 8)
  return d.replace(/^(\d{5})(\d)/, '$1-$2')
}

export function formatBRLFromCents(cents: number) {
  return (cents / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function parseBRLInput(v: string): { cents: number; formatted: string } {
  const digits = onlyDigits(v).slice(0, 13)
  if (!digits) return { cents: 0, formatted: '' }
  const cents = parseInt(digits, 10)
  return { cents, formatted: formatBRLFromCents(cents) }
}

export function formatBRLFromNumber(n: number) {
  return formatBRLFromCents(Math.round(n * 100))
}

export function nextDateForDay(day: number): string {
  const today = new Date()
  let year = today.getFullYear()
  let month = today.getMonth()
  if (day < today.getDate()) {
    month += 1
    if (month > 11) {
      month = 0
      year += 1
    }
  }
  const lastDay = new Date(year, month + 1, 0).getDate()
  const actualDay = Math.min(day, lastDay)
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(actualDay).padStart(2, '0')}`
}

export function dayFromISO(iso: string): number {
  const parts = iso.split('-')
  if (parts.length !== 3) return 1
  return parseInt(parts[2], 10) || 1
}

export function isoToBR(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export function daysUntil(iso: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const [y, m, d] = iso.split('-').map(Number)
  const target = new Date(y, m - 1, d)
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

export function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? ''
}

export function phoneToE164(stored: string | null | undefined): string | null {
  if (!stored) return null
  const digits = onlyDigits(stored)
  if (!digits) return null
  return `+${digits}`
}

// Formato BR para WhatsApp Business legado: 55 + DDD + número (sem o 9 extra de celular).
// "+55 (69) 99914-5425" → "556999145425"
export function phoneBRWithout9(stored: string | null | undefined): string | null {
  if (!stored) return null
  const digits = onlyDigits(stored)
  if (!digits) return null
  if (digits.length === 13 && digits.startsWith('55') && digits.charAt(4) === '9') {
    return digits.slice(0, 4) + digits.slice(5)
  }
  return digits
}

export function phoneToWhatsappURL(stored: string | null | undefined): string | null {
  if (!stored) return null
  const digits = onlyDigits(stored)
  if (digits.length < 10) return null
  return `https://wa.me/${digits}`
}

export function formatEnderecoLinha(e: {
  cep: string | null
  logradouro: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
}): string | null {
  const rua = [e.logradouro, e.numero].filter(Boolean).join(', ')
  const compl = e.complemento ? ` (${e.complemento})` : ''
  const bairroCidade = [e.bairro, [e.cidade, e.uf].filter(Boolean).join('/')]
    .filter(Boolean)
    .join(', ')
  const cep = e.cep ? `CEP ${e.cep}` : ''
  const parts = [rua + compl, bairroCidade, cep].filter(Boolean)
  if (parts.length === 0) return null
  return parts.join(' — ')
}

export type Country = { dial: string; name: string; flag: string; iso: string }

export const COUNTRIES: Country[] = [
  { iso: 'BR', dial: '55',  name: 'Brasil',         flag: '🇧🇷' },
  { iso: 'US', dial: '1',   name: 'Estados Unidos', flag: '🇺🇸' },
  { iso: 'PT', dial: '351', name: 'Portugal',       flag: '🇵🇹' },
  { iso: 'AR', dial: '54',  name: 'Argentina',      flag: '🇦🇷' },
  { iso: 'CL', dial: '56',  name: 'Chile',          flag: '🇨🇱' },
  { iso: 'CO', dial: '57',  name: 'Colômbia',       flag: '🇨🇴' },
  { iso: 'MX', dial: '52',  name: 'México',         flag: '🇲🇽' },
  { iso: 'PE', dial: '51',  name: 'Peru',           flag: '🇵🇪' },
  { iso: 'UY', dial: '598', name: 'Uruguai',        flag: '🇺🇾' },
  { iso: 'PY', dial: '595', name: 'Paraguai',       flag: '🇵🇾' },
  { iso: 'BO', dial: '591', name: 'Bolívia',        flag: '🇧🇴' },
  { iso: 'EC', dial: '593', name: 'Equador',        flag: '🇪🇨' },
  { iso: 'VE', dial: '58',  name: 'Venezuela',      flag: '🇻🇪' },
  { iso: 'GB', dial: '44',  name: 'Reino Unido',    flag: '🇬🇧' },
  { iso: 'ES', dial: '34',  name: 'Espanha',        flag: '🇪🇸' },
  { iso: 'FR', dial: '33',  name: 'França',         flag: '🇫🇷' },
  { iso: 'DE', dial: '49',  name: 'Alemanha',       flag: '🇩🇪' },
  { iso: 'IT', dial: '39',  name: 'Itália',         flag: '🇮🇹' },
  { iso: 'JP', dial: '81',  name: 'Japão',          flag: '🇯🇵' },
  { iso: 'CN', dial: '86',  name: 'China',          flag: '🇨🇳' },
]

export function formatPhoneBR(v: string) {
  const d = onlyDigits(v).slice(0, 11)
  if (d.length <= 2) return d
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

export function formatPhoneIntl(v: string) {
  return onlyDigits(v).slice(0, 15)
}

export function formatPhoneByCountry(dial: string, v: string) {
  return dial === '55' ? formatPhoneBR(v) : formatPhoneIntl(v)
}

export function composePhone(dial: string, num: string) {
  const d = onlyDigits(dial)
  const n = num.trim()
  if (!n) return ''
  if (!d) return n
  return `+${d} ${n}`
}

export function parsePhone(
  stored: string | null | undefined,
): { dial: string; numero: string } {
  if (!stored) return { dial: '55', numero: '' }
  const match = stored.match(/^\+(\d{1,3})\s*(.+)$/)
  if (match) {
    const dial = match[1]
    return { dial, numero: formatPhoneByCountry(dial, match[2]) }
  }
  // legado: "(XX) XXXXX-XXXX" sem DDI
  return { dial: '55', numero: formatPhoneBR(stored) }
}

export async function fetchCnpj(cnpj: string): Promise<CnpjData> {
  const digits = onlyDigits(cnpj)
  if (digits.length !== 14) throw new Error('CNPJ deve ter 14 dígitos')
  const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`)
  if (!r.ok) throw new Error('CNPJ não encontrado')
  const j = await r.json()
  const ddd = j.ddd_telefone_1 as string | undefined
  return {
    cnpj: formatCnpj(digits),
    razao_social: j.razao_social ?? '',
    nome_fantasia: j.nome_fantasia || null,
    email: j.email || null,
    telefone: ddd ? ddd : null,
  }
}

export async function fetchCep(cep: string): Promise<CepData> {
  const digits = onlyDigits(cep)
  if (digits.length !== 8) throw new Error('CEP deve ter 8 dígitos')
  const r = await fetch(`https://viacep.com.br/ws/${digits}/json/`)
  if (!r.ok) throw new Error('Erro ao buscar CEP')
  const j = await r.json()
  if (j.erro) throw new Error('CEP não encontrado')
  return {
    cep: formatCep(digits),
    logradouro: j.logradouro || null,
    bairro: j.bairro || null,
    cidade: j.localidade || null,
    uf: j.uf || null,
  }
}
