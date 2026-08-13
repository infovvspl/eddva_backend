import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolRolesService {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  async create(user: any, dto: { name: string; description?: string; permissions?: string[] }) {
    const instituteId = user.instituteId;
    const existing: any[] = await this.ds.query(
      `SELECT id FROM roles WHERE institute_id = $1 AND name = $2`,
      [instituteId, dto.name]
    );

    if (existing.length) {
      throw new ConflictException(`Role with name "${dto.name}" already exists in this institute`);
    }

    const rows: any[] = await this.ds.query(
      `INSERT INTO roles (institute_id, name, description, permissions) 
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [instituteId, dto.name, dto.description || null, JSON.stringify(dto.permissions || [])]
    );

    return { success: true, data: rows[0] };
  }

  async findAll(user: any) {
    const instituteId = user.instituteId;
    const rows: any[] = await this.ds.query(
      `SELECT * FROM roles WHERE institute_id = $1 ORDER BY created_at ASC`,
      [instituteId]
    );
    return { success: true, data: rows };
  }

  async findOne(user: any, id: string) {
    const instituteId = user.instituteId;
    const rows: any[] = await this.ds.query(
      `SELECT * FROM roles WHERE id = $1 AND institute_id = $2`,
      [id, instituteId]
    );
    if (!rows.length) throw new NotFoundException(`Role ${id} not found`);
    return { success: true, data: rows[0] };
  }

  async update(user: any, id: string, dto: { name?: string; description?: string; permissions?: string[] }) {
    const instituteId = user.instituteId;
    const existing = await this.findOne(user, id);

    if (dto.name && dto.name !== existing.data.name) {
      const nameCheck: any[] = await this.ds.query(
        `SELECT id FROM roles WHERE institute_id = $1 AND name = $2`,
        [instituteId, dto.name]
      );
      if (nameCheck.length) {
        throw new ConflictException(`Role with name "${dto.name}" already exists`);
      }
    }

    const name = dto.name || existing.data.name;
    const description = dto.description !== undefined ? dto.description : existing.data.description;
    const permissions = dto.permissions ? JSON.stringify(dto.permissions) : JSON.stringify(existing.data.permissions);

    const rows: any[] = await this.ds.query(
      `UPDATE roles SET name = $1, description = $2, permissions = $3, updated_at = NOW() 
       WHERE id = $4 AND institute_id = $5 RETURNING *`,
      [name, description, permissions, id, instituteId]
    );

    return { success: true, data: rows[0] };
  }

  async remove(user: any, id: string) {
    const instituteId = user.instituteId;
    await this.findOne(user, id); // Ensure exists
    await this.ds.query(
      `DELETE FROM roles WHERE id = $1 AND institute_id = $2`,
      [id, instituteId]
    );
    return { success: true };
  }
}
