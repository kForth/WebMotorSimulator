function Simulator(motors,  // Motor object
                   gear_ratio,  // Gear ratio, driven/driving
                   motor_current_limit,  // Current limit per motor, A
                   motor_peak_current_limit,  // Peak Current limit per motor, A
                   motor_voltage_limit,  // Voltage limit per motor, V
                   effective_diameter,  // Effective diameter, m
                   effective_mass,  // Effective mass, kg
                   k_gearbox_efficiency,  // Gearbox efficiency fraction
                   incline_angle,  // Incline angle relative to ground, deg
                   check_for_slip, //Check for slip
                   coeff_kinetic_friction,  // µk
                   coeff_static_friction,  // µs
                   k_resistance_s,  // static resistance, N
                   k_resistance_v,  // viscous resistance, N/(ft/s)
                   battery_voltage,  // Fully-charged open-circuit battery voltage
                   resistance_com,  // Resistance from bat to PDB (incl main breaker, Ω
                   resistance_idv,  // Resistance from PDB to motor (incl PDB breaker), Ω
                   time_step,  // Integration step size, s
                   simulation_time,  // Integration duration, s
                   max_dist,  // Max distance to integrate to, m
                   init_pos,  // Initial position to start simulation from, m
                   init_vel,  // Initial velocity to start simulation from, m/s
                   init_accel) {  // Initial acceleration to start simulation from, m/s/s
    this.motors = motors;
    this.num_motors = this.motors.num_motors;
    this.k_resistance_s = k_resistance_s;
    this.k_resistance_v = k_resistance_v;
    this.k_gearbox_efficiency = k_gearbox_efficiency;
    this.gear_ratio = gear_ratio;
    this.effective_diameter = effective_diameter;
    this.incline_angle = incline_angle;
    this.effective_mass = effective_mass;
    this.check_for_slip = check_for_slip;
    this.coeff_kinetic_friction = coeff_kinetic_friction;
    this.coeff_static_friction = coeff_static_friction;
    this.motor_current_limit = motor_current_limit;
    this.motor_peak_current_limit = motor_peak_current_limit;
    this.motor_voltage_limit = motor_voltage_limit;
    this.battery_voltage = battery_voltage;
    this.resistance_com = resistance_com;
    this.resistance_idv = resistance_idv;
    this.time_step = time_step === undefined ? 0.01 : time_step;
    this.simulation_time = simulation_time === undefined ? 20 : simulation_time;
    this.max_dist = max_dist === undefined ? 5 : max_dist;
    this.init_pos = init_pos === undefined ? 0 : init_pos;
    this.init_vel = init_vel === undefined ? 0 : init_vel;
    this.init_accel = init_accel === undefined ? 0 : init_accel;

    this._time = 0;  // elapsed time, seconds
    this._position = this.initial_position;  // distance traveled, meters
    this._velocity = this.initial_velocity; // speed, meters/sec
    this._acceleration = this.initial_acceleration; // acceleration, meters/sec/sec
    this._voltage = this.battery_voltage; // Voltage at the motor
    this._current_per_motor = 0; // current per motor, amps
    this._energy_per_motor = 0; // power used, mAh
    this._cumulative_energy = 0; // total power used mAh
    this._slipping = false;
    this._brownout = false;
    this._voltage_setpoint = 0;
    this._current_history_size = 20;
    this._current_history = [];
    this._was_current_limited = false;
    this.data_points = [];
    this.effective_radius = this.effective_diameter / 2;
    this.effective_weight = this.effective_mass * 9.80665;  // effective weight, Newtons

    this.initVars = function () {
        this._time = 0;  // elapsed time, seconds
        this._position = this.init_pos;  // distance traveled, meters
        this._velocity = this.init_vel; // speed, meters/sec
        this._acceleration = this.init_accel; // acceleration, meters/sec/sec
        this._voltage = this.battery_voltage; // Voltage at the motor
        this._current_per_motor = 0; // current per motor, amps
        this._energy_per_motor = 0; // power used, mAh
        this._cumulative_energy = 0; // total power used mAh
        this._slipping = false;
        this._brownout = false;
        this._voltage_setpoint = 0;
        this._current_history = [];
        this._was_current_limited = false;
        this.data_points = [];
    };

    this.getGravityForce = function () {
        return this.effective_weight * Math.sin(this.incline_angle / 180 * Math.PI);
    };

    this.getNormalForce = function () {
        return this.effective_weight * Math.cos(this.incline_angle / 180 * Math.PI);
    };

    this._calc_max_accel = function (velocity) {
        var motor_speed = velocity / this.effective_radius * this.gear_ratio;


        var available_voltage = this._voltage;
        if (this.motor_voltage_limit) {
            available_voltage = Math.min(this._voltage, this.motor_voltage_limit);
        }

        this._current_per_motor = (available_voltage - (motor_speed / this.motors.k_v)) / this.motors.k_r;

        if (velocity > 0 && this.motor_current_limit !== undefined && this.motor_current_limit !== null) {
            var current_sum = 0;
            this._current_history.forEach(function (e) {
                current_sum += e;
            });
            if (((current_sum / this._current_history.length) > this.motor_current_limit) || this._was_current_limited) {
                this._was_current_limited = true;
                this._current_per_motor = Math.min(this._current_per_motor, this.motor_current_limit);
            }
        }
        if (this.motor_peak_current_limit !== undefined && this.motor_peak_current_limit !== null) {
            this._current_per_motor = Math.min(this._current_per_motor, this.motor_peak_current_limit);
        }

        var max_torque_at_voltage = this.motors.k_t * this._current_per_motor;

        var available_torque_at_axle = this.k_gearbox_efficiency * max_torque_at_voltage * this.gear_ratio;
        var available_force_at_axle = available_torque_at_axle / this.effective_radius;

        if (this.check_for_slip) {
            if (available_force_at_axle > this.getNormalForce() * this.coeff_static_friction) {
                this._slipping = true;
            }
            else if (available_force_at_axle < this.getNormalForce() * this.coeff_kinetic_friction) {
                this._slipping = false;
            }

            if (this._slipping) {
                available_force_at_axle = (this.getNormalForce() * this.coeff_kinetic_friction);
            }
        }

        this._voltage = this.battery_voltage - (this.num_motors * this._current_per_motor * this.resistance_idv) - (this._current_per_motor * this.resistance_com);

        this._brownout = this._voltage < 7;

        var tuned_resistance = this.k_resistance_s + this.k_resistance_v * velocity;  // rolling resistance, N
        var net_accel_force = available_force_at_axle - tuned_resistance - this.getGravityForce();  // Net force, N

        if (net_accel_force < 0 && this._position <= 0) {
            net_accel_force = 0;
        }

        return net_accel_force / this.effective_mass;
    };

    this._integrate_with_heun = function () { // numerical integration using Heun's Method
        this._time = this.time_step;
        while (this._time < (this.simulation_time + this.time_step) && (this._position < this.max_dist || this.max_dist === undefined)) {
            var v_temp = this._velocity + this._acceleration * this.time_step; // kickstart with Euler step
            var a_temp = this._calc_max_accel(v_temp);
            v_temp = this._velocity + (this._acceleration + a_temp) / 2 * this.time_step; // recalc v_temp trapezoidally

            this._position += (this._velocity + v_temp) / 2 * this.time_step; // update x trapezoidally
            this._velocity = v_temp;  // update V
            this._acceleration = this._calc_max_accel(v_temp);  // update a

            this._energy_per_motor = this._current_per_motor * this.time_step * 1000 / 60;  // calc power usage in mAh
            this._cumulative_energy += this._energy_per_motor * this.num_motors;

            this._current_history.push(this._current_per_motor);
            if (this._current_history.length > this._current_history_size) {
                var len = this._current_history.length;
                this._current_history = this._current_history.splice(len - this._current_history_size, len);
            }

            this.addDataPoint();
            this._time += this.time_step;
        }
    };

    this.addDataPoint = function () {
        this.data_points.push({
            'time': this._time,
            'pos': this._position,
            'vel': this._velocity,
            'accel': this._acceleration,
            'voltage': this._voltage_setpoint,
            'current': this._current_per_motor,
            'total_current': this._current_per_motor * this.num_motors,
            'sys_voltage': this._voltage,
            'energy': this._energy_per_motor,
            'total_energy': this._cumulative_energy,
            'slipping': this._slipping ? 1 : 0,
            'brownout': this._brownout ? 1 : 0,
            'gravity': this.getGravityForce()
        });
    };

    this.getDataPoints = function () {
        return this.data_points;
    };

    this.getFinalPoint = function () {
        return this.data_points[this.data_points.length - 1];
    };

    this.calc = function () {
        this._acceleration = this._calc_max_accel(this._velocity);  // compute accel at t=0
        this.addDataPoint();  // output values at t=0

        this._integrate_with_heun();  // numerically integrate and output using Heun's method
    };

    this.initVars();
    this.calc();

    return this;
}

var DATA_HEADERS = {
    'time':          'Time (s)',
    'pos':           'Position (m)',
    'vel':           'Velocity (m/s)',
    'accel':         'Acceleration (m/s/s)',
    'voltage':       'Voltage (V)',
    'current':       'Current/10 (A)',
    'total_current': 'Total Current/100 (A)',
    'sys_voltage':   'System Voltage (V)',
    'energy':        'Energy (mAh)',
    'total_energy':  'Total Energy/10 (mAh)',
    'slipping':      'Slipping',
    'brownout':      'Brownout',
    'gravity':       'Force of Gravity (N)'
};

var DATA_SCALE_FACTORS = {
    'time':          1,
    'pos':           1,
    'vel':           1,
    'accel':         1,
    'voltage':       1,
    'current':       10,
    'total_current': 100,
    'sys_voltage':   1,
    'energy':        100,
    'total_energy':  10,
    'slipping':      1,
    'brownout':      1,
    'gravity':       1
};

var MOTORS = [
    {
        name: "CIM",
        max_voltage: 12,
        free_rpm: 5330,
        stall_torque: 2.41,
        stall_current: 131,
        free_current: 2.7
    },
    {
        name: "MiniCIM",
        max_voltage: 12,
        free_rpm: 5840,
        stall_torque: 1.41,
        stall_current: 89,
        free_current: 3
    },
    {
        name: "BAG",
        max_voltage: 12,
        free_rpm: 13180,
        stall_torque: 0.43,
        stall_current: 53,
        free_current: 1.8
    },
    {
        name: "775pro",
        max_voltage: 12,
        free_rpm: 18730,
        stall_torque: 0.71,
        stall_current: 134,
        free_current: 0.7
    },
    {
        name: "AM 9015",
        max_voltage: 12,
        free_rpm: 14270,
        stall_torque: 0.36,
        stall_current: 71,
        free_current: 3.7
    },
    {
        name: "NeveRest",
        max_voltage: 12,
        free_rpm: 5480,
        stall_torque: 0.17,
        stall_current: 10,
        free_current: 0.4
    },
    {
        name: "RS775-125",
        max_voltage: 12,
        free_rpm: 5800,
        stall_torque: 0.28,
        stall_current: 18,
        free_current: 1.6
    },
    {
        name: "Banebot RS775-18V",
        max_voltage: 12,
        free_rpm: 13050,
        stall_torque: 0.72,
        stall_current: 97,
        free_current: 2.7
    },
    {
        name: "Banebots RS550",
        max_voltage: 12,
        free_rpm: 19000,
        stall_torque: 0.38,
        stall_current: 84,
        free_current: 0.4
    }
];