export type ClienteTipo = 'pf' | 'pj'

export type Cliente = {
  id: string
  tipo: ClienteTipo
  documento: string
  nome: string
  nome_fantasia: string | null
  email: string | null
  telefone: string | null
  cep: string | null
  logradouro: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
  created_at: string
}

export type CobrancaStatus = 'pendente' | 'pago' | 'atrasado' | 'cancelado'

export type Cobranca = {
  id: string
  cliente_id: string
  descricao: string
  valor: number
  vencimento: string
  status: CobrancaStatus
  pago_em: string | null
  created_at: string
}

export type Database = {
  public: {
    Tables: {
      clientes: {
        Row: Cliente
        Insert: Omit<Cliente, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<Cliente, 'id' | 'created_at'>>
      }
      cobrancas: {
        Row: Cobranca
        Insert: Omit<Cobranca, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<Cobranca, 'id' | 'created_at'>>
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
  }
}
