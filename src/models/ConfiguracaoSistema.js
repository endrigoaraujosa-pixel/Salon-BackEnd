import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { getTenantSchema } from '../config/tenantContext.js';

const ConfiguracaoSistema = sequelize.define('ConfiguracaoSistema', {
  permitir_fotos_atendimentos: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  },
  // Credenciais B2 — armazenadas no banco para configuração via UI sem redeploy.
  // Têm prioridade sobre as variáveis de ambiente B2_KEY_ID / B2_APPLICATION_KEY.
  // A applicationKey nunca é devolvida pela API GET (veja configuracaoController).
  b2_key_id: { type: DataTypes.STRING(100), allowNull: true },
  b2_key_name: { type: DataTypes.STRING(100), allowNull: true },
  b2_application_key: { type: DataTypes.STRING(255), allowNull: true },
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  bloquear_valor_agendamento_menor: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  },
  permitir_estoque_negativo: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  },
  permitir_cliente_duplicado: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  },
  descontar_taxa_cartao_comissao: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  },
  trabalhar_credito_cliente: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  },
  agendamento_online_ativo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false
  },
  ocultar_valores_online: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  },
  max_servicos_agendamento_online: {
    type: DataTypes.INTEGER,
    defaultValue: null,
    allowNull: true
  },
  aceitar_agendamento_online_automatico: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  },
  max_agendamentos_online_futuros: {
    type: DataTypes.INTEGER,
    defaultValue: null,
    allowNull: true
  },
  permitir_alterar_preco_produto_venda: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  }
}, {
  tableName: 'configuracao_sistema',
  createdAt: 'criado_em',
  updatedAt: 'atualizado_em',
  // Nunca expõe a chave secreta do B2 nas consultas padrão
  defaultScope: { attributes: { exclude: ['b2_application_key'] } }
});

export const getConfiguracaoSistemaModel = () => {
  const tenant = getTenantSchema();
  return ConfiguracaoSistema.schema(tenant);
};

export default ConfiguracaoSistema;
