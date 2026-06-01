import type { Role } from '@/lib/auth'

export type ClienteTipo = 'pf' | 'pj'

export type Cliente = {
  id: string
  user_id: string
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

export type EnvioStatus = 'enviado' | 'entregue' | 'lido' | 'falha'

export type Mensagem = {
  id: string
  user_id: string
  cliente_id: string | null
  instancia: string | null
  chave_api: string | null
  message_id: string | null
  telefone: string | null
  conteudo: string | null
  enviado_em: string
}

export type MensagemStatus = {
  id: string
  mensagem_id: string
  user_id: string
  status: EnvioStatus
  erro: string | null
  entregue_em: string | null
  lido_em: string | null
  falhou_em: string | null
  atualizado_em: string
  instancia: string | null
  chave_api: string | null
  message_id: string | null
}

export type CobrancaStatus = 'pendente' | 'pago' | 'atrasado' | 'cancelado'

export type Cobranca = {
  id: string
  user_id: string
  cliente_id: string
  nome: string | null
  descricao: string
  valor: number
  vencimento: string
  status: CobrancaStatus
  pago_em: string | null
  created_at: string
}

export type ProfileRow = {
  id: string
  email: string | null
  nome: string | null
  role: Role
  evolution_instancia: string | null
  evolution_api_key: string | null
  conversa_tabela: string | null
  created_at: string
}

export type ConversaMsg = {
  id: string
  telefone: string | null
  conteudo: string | null
  direcao: 'in' | 'out' | string
  criada_em: string
  // Campos opcionais: presentes só quando a mensagem vem de mensagens_atendente
  source?: 'ai' | 'atendente'
  atendente_nome?: string | null
  base64?: string | null
  midia_type?: string | null
}

type TableShape<R, I, U> = {
  Row: R
  Insert: I
  Update: U
  Relationships: []
}

export type Database = {
  public: {
    Tables: {
      clientes: TableShape<
        Cliente,
        Partial<Pick<Cliente, 'id' | 'user_id' | 'created_at'>> &
          Omit<Cliente, 'id' | 'user_id' | 'created_at'>,
        Partial<Omit<Cliente, 'id' | 'created_at'>>
      >
      cobrancas: TableShape<
        Cobranca,
        Partial<Pick<Cobranca, 'id' | 'user_id' | 'created_at'>> &
          Omit<Cobranca, 'id' | 'user_id' | 'created_at'>,
        Partial<Omit<Cobranca, 'id' | 'created_at'>>
      >
      mensagens: TableShape<
        Mensagem,
        Partial<Pick<Mensagem, 'id' | 'user_id' | 'enviado_em'>> &
          Omit<Mensagem, 'id' | 'user_id' | 'enviado_em'>,
        Partial<Omit<Mensagem, 'id'>>
      >
      mensagem_status: TableShape<
        MensagemStatus,
        Partial<Pick<MensagemStatus, 'id' | 'user_id' | 'atualizado_em'>> &
          Omit<MensagemStatus, 'id' | 'user_id' | 'atualizado_em'>,
        Partial<Omit<MensagemStatus, 'id' | 'mensagem_id'>>
      >
      profiles: TableShape<
        ProfileRow,
        Partial<ProfileRow> & { id: string },
        Partial<Omit<ProfileRow, 'id' | 'created_at'>>
      >
    }
    Views: Record<string, never>
    Functions: {
      admin_create_user: {
        Args: {
          p_email: string
          p_password: string
          p_nome: string | null
          p_role: Role
          p_evolution_instancia: string | null
          p_evolution_api_key: string | null
          p_conversa_tabela: string | null
        }
        Returns: string
      }
      admin_delete_user: {
        Args: { target_id: string }
        Returns: void
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
