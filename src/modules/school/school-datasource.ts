import { DataSource } from 'typeorm';
import { schoolDbConfig } from '../../config/database.config';

export default new DataSource({ ...schoolDbConfig } as any);
