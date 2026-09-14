import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { getTenantSchema } from '../config/tenantContext.js';

const Foto = sequelize.define('AtendimentoFoto', {
  id: { type: DataTypes.STRING(36), primaryKey: true },
  agendamento_id: { type: DataTypes.STRING(36), allowNull: false },
  cliente_id: { type: DataTypes.STRING(36), allowNull: false },
  largura: { type: DataTypes.INTEGER, allowNull: false },
  altura: { type: DataTypes.INTEGER, allowNull: false },
  bytes: { type: DataTypes.INTEGER, allowNull: false },
  imagem: { type: DataTypes.BLOB, allowNull: false },
  miniatura: { type: DataTypes.BLOB, allowNull: false },
  criado_por_id: DataTypes.STRING(36),
  criado_em: { type: DataTypes.DATE, allowNull: false }
}, { tableName: 'atendimento_fotos', timestamps: false,
  defaultScope: { attributes: { exclude: ['imagem', 'miniatura'] } } });

const Evento = sequelize.define('AtendimentoFotoEvento', {
  id: { type: DataTypes.STRING(36), primaryKey: true },
  foto_id: { type: DataTypes.STRING(36), allowNull: false },
  agendamento_id: { type: DataTypes.STRING(36), allowNull: false },
  cliente_id: { type: DataTypes.STRING(36), allowNull: false },
  operacao: { type: DataTypes.STRING(20), allowNull: false },
  usuario_id: DataTypes.STRING(36),
  criado_em: { type: DataTypes.DATE, allowNull: false }
}, { tableName: 'atendimento_foto_eventos', timestamps: false });

export const getAtendimentoFotoModel = () => Foto.schema(getTenantSchema());
export const getAtendimentoFotoEventoModel = () => Evento.schema(getTenantSchema());
