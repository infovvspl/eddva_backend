import { DataSource } from 'typeorm';
import { schoolDbConfig } from './database.config';

export default new DataSource(schoolDbConfig);
