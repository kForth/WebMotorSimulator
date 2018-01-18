var app = angular.module('app', ['ngAnimate', 'ui.bootstrap', 'ngStorage', 'chart.js', 'ui.sortable']);

String.prototype.toProperCase = function () {
    return this.replace(/\w\S*/g, function (txt) {
        return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
    });
};

String.prototype.replaceAll = function (str1, str2, ignore) {
    return this.replace(new RegExp(str1.replace(/([\/\,\!\\\^\$\{\}\[\]\(\)\.\*\+\?\|\<\>\-\&])/g, "\\$&"), (ignore ? "gi" : "g")), (typeof(str2) == "string") ? str2.replace(/\$/g, "$$$$") : str2);
};

function Simulator(motors,  // Motor object
                   gear_ratio,  // Gear ratio, driven/driving
                   motor_current_limit,  // Current limit per motor, A
                   motor_peak_current_limit,  // Peak Current limit per motor, A
                   motor_voltage_limit,  // Voltage limit per motor, V
                   effective_diameter,  // Effective diameter, m
                   effective_mass,  // Effective mass, kg
                   k_gearbox_efficiency,  // Gearbox efficiency fraction
                   incline_angle,  // Incline angle relative to ground, deg
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
    this.check_for_slip = true;
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

    if (this.check_for_slip) {
        this.traction_limited = ((this.motor_current_limit === undefined ? this.motors.stall_current : this.motor_current_limit) * this.motors.k_t * this.gear_ratio * this.k_gearbox_efficiency / this.effective_radius) > (this.effective_weight * this.coeff_static_friction)
        console.log('\tTraction Limited: ' + this.traction_limited);
    }
    if (this.incline_angle > 0) {
        console.log('\tHold Current: ' + this.getGravityForce() * this.effective_radius / this.gear_ratio / this.motors.k_t);
    }

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
        return this.effective_weight * Math.sin(this.incline_angle * 180 / Math.PI);
    };

    this._calc_max_accel = function (velocity) {
        var motor_speed = velocity / this.effective_radius * this.gear_ratio;


        var available_voltage = this._voltage;
        if (this.motor_voltage_limit) {
            available_voltage = Math.min(this._voltage, this.motor_voltage_limit);
        }

        this._current_per_motor = (available_voltage - (motor_speed / this.motors.k_v)) / this.motors.k_r;

        if (velocity > 0 && this.motor_current_limit !== undefined && this.motor_current_limit !== null) {
            var current_sum = this._current_history.reduce(function (a, b) {
                return a + b
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
            if (available_force_at_axle > this.effective_weight * this.coeff_static_friction) {
                this._slipping = true;
            }
            else if (available_force_at_axle < this.effective_weight * this.coeff_kinetic_friction) {
                this._slipping = false;
            }

            if (this._slipping) {
                available_force_at_axle = (this.effective_weight * this.coeff_kinetic_friction);
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

app.controller('ApplicationController', function ($scope, $localStorage, $sessionStorage, $location, $http, $log) {
    $scope.model_types = [
        {
            name: 'Drivetrain',
            distance_unit: 'm',
            model: {
                motor_type: "",
                num_motors: 4,
                gear_ratio: 10,
                effective_diameter: 0.15,
                effective_mass: 65,
                motor_current_limit: null,
                motor_peak_current_limit: null,
                motor_voltage_limit: null,
                k_gearbox_efficiency: 0.7,
                coeff_kinetic_friction: 0.8,
                coeff_static_friction: 1.0,
                incline_angle: 0,
                k_resistance_s: 0,
                k_resistance_v: 0,
                battery_voltage: 12.5,
                resistance_com: 0.013,
                resistance_idv: 0.002,
                time_step: 0.01,
                simulation_time: 10.0,
                max_dist: 8
            }
        },
        {
            name: 'Elevator',
            distance_unit: 'm',
            model: {
                motor_type: "",
                num_motors: 2,
                gear_ratio: 10,
                effective_diameter: 2 * 0.0254,
                effective_mass: 10,
                motor_current_limit: null,
                motor_peak_current_limit: null,
                motor_voltage_limit: null,
                k_gearbox_efficiency: 0.7,
                coeff_kinetic_friction: 0.8,
                coeff_static_friction: 1.0,
                incline_angle: 0,
                k_resistance_s: 0,
                k_resistance_v: 0,
                battery_voltage: 12.5,
                resistance_com: 0.013,
                resistance_idv: 0.002,
                time_step: 0.01,
                simulation_time: 10.0,
                max_dist: 8
            }
        },
        {
            name: 'Arm',
            distance_unit: 'rad',
            model: {
                motor_type: "",
                num_motors: 2,
                gear_ratio: 10,
                effective_diameter: 1,
                effective_mass: 10,
                motor_current_limit: null,
                motor_peak_current_limit: null,
                motor_voltage_limit: null,
                k_gearbox_efficiency: 0.7,
                coeff_kinetic_friction: 0.8,
                coeff_static_friction: 1.0,
                incline_angle: 0,
                k_resistance_s: 0,
                k_resistance_v: 0,
                battery_voltage: 12.5,
                resistance_com: 0.013,
                resistance_idv: 0.002,
                time_step: 0.01,
                simulation_time: 10.0,
                max_dist: 8
            }
        }
    ];

    $scope.motors = [
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

    $scope.settings_collapsed = [
        {'basic': false},
        {'power': true},
        {'advanced': true},
        {'battery': true},
        {'simulation': true}
    ];

    $scope.settings_categories = [
        {
            text: 'Basic Settings',
            key: 'basic',
            collapsed: false
        },
        {
            text: 'Power Settings',
            key: 'power',
            collapsed: true
        },
        {
            text: 'Advanced Settings',
            key: 'advanced',
            collapsed: true
        },
        {
            text: 'Battery Settings',
            key: 'battery',
            collapsed: true
        },
        {
            text: 'Simulation Settings',
            key: 'simulation',
            collapsed: true
        }
    ];

    var model_inputs = {
        'Drivetrain': [
            {
                label: 'Name',
                key: 'name',
                type: 'text',
                required: true,
                unique: true,
                order: 11
            },
            {
                label: 'Motor Type',
                key: 'motor_type',
                type: 'motor_type',
                required: true,
                unique: false,
                order: 12
            },
            {
                label: 'Num Motors',
                key: 'num_motors',
                type: 'number',
                required: true,
                unique: false,
                order: 22
            },
            {
                label: 'Gear Ratio',
                key: 'gear_ratio',
                type: 'number',
                suffix: ':1',
                required: true,
                unique: false,
                order: 21
            },
            {
                label: 'Wheel Diameter',
                key: 'effective_diameter',
                type: 'number',
                suffix: 'm',
                required: true,
                unique: false,
                order: 31
            },
            {
                label: 'Coeff of Friction',
                key: 'coeff_static_friction',
                type: 'number',
                required: true,
                unique: false,
                order: 32
            },
            {
                label: 'Robot Mass',
                key: 'effective_mass',
                type: 'number',
                suffix: 'kg',
                required: true,
                unique: false,
                order: 41
            }
        ],
        'Elevator': [
            {
                label: 'Name',
                key: 'name',
                type: 'text',
                required: true,
                unique: true,
                order: 11
            },
            {
                label: 'Motor Type',
                key: 'motor_type',
                type: 'motor_type',
                required: true,
                unique: false,
                order: 12
            },
            {
                label: 'Num Motors',
                key: 'num_motors',
                type: 'number',
                required: true,
                unique: false,
                order: 22
            },
            {
                label: 'Gear Ratio',
                key: 'gear_ratio',
                type: 'number',
                suffix: ':1',
                required: true,
                unique: false,
                order: 21
            },
            {
                label: 'Pulley Diameter',
                key: 'effective_diameter',
                type: 'number',
                suffix: 'm',
                required: true,
                unique: false,
                order: 31
            },
            {
                label: 'Coeff of Friction',
                key: 'coeff_static_friction',
                type: 'number',
                required: true,
                unique: false,
                order: 32
            },
            {
                label: 'Mass',
                key: 'effective_mass',
                type: 'number',
                suffix: 'kg',
                required: true,
                unique: false,
                order: 41
            }
        ],
        'Arm': [
            {
                label: 'Name',
                key: 'name',
                type: 'text',
                required: true,
                unique: true,
                order: 11
            },
            {
                label: 'Motor Type',
                key: 'motor_type',
                type: 'motor_type',
                required: true,
                unique: false,
                order: 12
            },
            {
                label: 'Num Motors',
                key: 'num_motors',
                type: 'number',
                required: true,
                unique: false,
                order: 22
            },
            {
                label: 'Gear Ratio',
                key: 'gear_ratio',
                type: 'number',
                suffix: ':1',
                required: true,
                unique: false,
                order: 21
            },
            {
                label: 'CG Distance * 2',
                key: 'effective_diameter',
                type: 'number',
                suffix: 'm',
                required: true,
                unique: false,
                order: 31
            },
            {
                label: 'Coeff of Friction',
                key: 'coeff_static_friction',
                type: 'number',
                required: true,
                unique: false,
                order: 32
            },
            {
                label: 'Arm Mass',
                key: 'effective_mass',
                type: 'number',
                suffix: 'kg',
                required: true,
                unique: false,
                order: 41
            }
        ]
    };

    $scope.getModelInputs = function (model_type) {
        var inputs = {
            'power': [
                {
                    label: 'Current Limit',
                    key: 'current_limit',
                    type: 'number',
                    suffix: 'A',
                    required: false,
                    unique: false,
                    order: 11
                },
                {
                    label: 'Peak Current Limit',
                    key: 'peak_current_limit',
                    type: 'number',
                    suffix: 'A',
                    required: false,
                    unique: false,
                    order: 21
                },
                {
                    label: 'Voltage Limit',
                    key: 'voltage_limit',
                    type: 'number',
                    suffix: 'V',
                    required: false,
                    unique: false,
                    order: 12
                },
                {
                    label: 'Gearbox Efficiency',
                    key: 'k_efficiency',
                    type: 'number',
                    suffix: '%',
                    required: false,
                    unique: false,
                    order: 22
                }
            ],
            'advanced': [
                {
                    label: 'Static Resistance',
                    key: 'k_resistance_s',
                    type: 'number',
                    suffix: 'N',
                    required: false,
                    unique: false,
                    order: 11
                },
                {
                    label: 'Viscous Resistance',
                    key: 'k_resistance_v',
                    type: 'number',
                    suffix: 'N/' + 'm' + '/s',
                    required: false,
                    unique: false,
                    order: 12
                },
                {
                    label: 'Coefficient of Kinetic Friction',
                    key: 'coeff_kinetic_friction',
                    type: 'number',
                    required: false,
                    unique: false,
                    order: 21
                },
                {
                    label: 'Incline Angle',
                    key: 'incline_angle',
                    type: 'number',
                    suffix: 'deg',
                    required: false,
                    unique: false,
                    order: 22
                }
            ],
            'battery': [
                {
                    label: 'Battery Voltage',
                    key: 'battery_voltage',
                    type: 'number',
                    suffix: 'V',
                    required: false,
                    unique: false,
                    order: 11
                },
                {
                    label: 'Common Resistance',
                    key: 'resistance_com',
                    type: 'number',
                    suffix: 'Ω',
                    tooltip: 'The resistance from the battery to the PDP, including connectors and main breaker.',
                    required: false,
                    unique: false,
                    order: 12
                },
                {
                    label: 'Individual Resistance',
                    key: 'resistance_idv',
                    type: 'number',
                    suffix: 'Ω',
                    tooltip: 'The resistance from the PDP to a motor, including breaker and speed controller.',
                    required: false,
                    unique: false,
                    order: 21
                }
            ],
            'simulation': [
                {
                    label: 'Max Time',
                    key: 'simulation_time',
                    type: 'number',
                    suffix: 's',
                    required: false,
                    unique: false,
                    order: 11
                },
                {
                    label: 'Max Dist',
                    key: 'max_dist',
                    type: 'number',
                    suffix: 'm',
                    required: false,
                    unique: false,
                    order: 12
                },
                {
                    label: 'Time Step',
                    key: 'time_step',
                    type: 'number',
                    suffix: 's',
                    required: false,
                    unique: false,
                    order: 21
                },
                {
                    label: 'Initial Position',
                    key: 'initial_position',
                    type: 'number',
                    suffix: 'm',
                    required: false,
                    unique: false,
                    order: 22
                },
                {
                    label: 'Initial Velocity',
                    key: 'initial_velocity',
                    type: 'number',
                    suffix: 'm' + '/s',
                    required: false,
                    unique: false,
                    order: 31
                },
                {
                    label: 'Intial Acceleration',
                    key: 'initial_acceleration',
                    type: 'number',
                    suffix: 'm' + '/s/s',
                    required: false,
                    unique: false,
                    order: 32
                }

            ],
            'basic': []
        };
        inputs.basic = model_inputs[model_type.name];
        return inputs;
    };

    $scope.models = $sessionStorage.models || [];
    $scope.models_collapsed = $sessionStorage.models_collapsed || {};
    $scope.scale_factors = $sessionStorage.scale_factors || {};
    $scope.visible_models = $sessionStorage.visible_models || {};
    $scope.visible_elements = $sessionStorage.visible_elements || {};
    $scope.temp_model = undefined;
    $scope.temp_model_type = undefined;
    $scope.temp_model_inputs = undefined;
    var next_model_id = (Math.max.apply(null, $scope.models.map(function(elem){return elem.id})) + 1) || 0;

    $scope.$watch('models', function () {
        $sessionStorage.models = $scope.models;
    });
    $scope.$watch('models_collapsed', function () {
        $sessionStorage.models_collapsed = $scope.models_collapsed;
    });
    $scope.$watch('visible_models', function () {
        $sessionStorage.visible_models = $scope.visible_models;
    });
    $scope.$watch('visible_elements', function () {
        $sessionStorage.visible_elements = $scope.visible_elements;
    });

    $scope.$watch(
        function () {
            return angular.toJson($sessionStorage);
        },
        function () {
            $scope.models = $sessionStorage.models;
            $scope.models_collapsed = $sessionStorage.models_collapsed;
            $scope.visible_models = $sessionStorage.visible_models;
            $scope.visible_elements = $sessionStorage.visible_elements;
        });

    function getMotors(motor_type, num_motors) {
        var motors = angular.copy(motor_type);
        motors.free_speed = motors.free_rpm * 2 * Math.PI / 60;  // convert RPM to rad/sec
        motors.k_r = motors.max_voltage / motors.stall_current;
        motors.k_v = motors.free_speed / (motors.max_voltage - motors.k_r * motors.free_current);
        motors.k_t = num_motors * motors.stall_torque / motors.stall_current;
        motors.num_motors = num_motors;
        return motors;
    }

    $scope.addModel = function (model_type) {
        $scope.model_input_errors = [];
        $scope.temp_model = angular.copy(model_type.model);
        $scope.temp_model_type = model_type;
        $scope.temp_model_inputs = $scope.getModelInputs(model_type);
        $scope.temp_model_index = undefined;
    };

    $scope.deleteModel = function (model) {
        $scope.models.splice($scope.models.indexOf(model), 1);
        delete $scope.models_collapsed[model.id];
        delete $scope.visible_models[model.id];
        $scope.loadLines();
    };

    $scope.editModel = function (model) {
        $scope.model_input_errors = [];
        $scope.temp_model_index = $scope.models.indexOf(model);
        $scope.temp_model = angular.copy(model);
        $scope.temp_model.motor_type = JSON.stringify($scope.temp_model.real_motor_type);
        $scope.temp_model_type = model.model_type;
        $scope.temp_model_inputs = $scope.getModelInputs(model.model_type);
    };

    $scope.duplicateModel = function (model) {
        var copied_model = angular.copy(model);
        copied_model.id = undefined;
        $scope.editModel(copied_model);
        $scope.temp_model_index = undefined;
    };

    $scope.submitModel = function () {
        $scope.model_input_errors = [];
        var model = angular.copy($scope.temp_model);
        model.model_type = $scope.temp_model_type;

        for (var key in model) { //Load default parameters in case the user erased them.
            if (model[key] === undefined || model[key] === "" || model[key] === null) {
                model[key] = $scope.temp_model_type.model[key];
            }
        }

        if (model.name === undefined || model.name === null || model.name === "") {
            $scope.model_input_errors.push('name');
        }

        if (model.motor_type === undefined || model.motor_type === null || model.motor_type === "") {
            $scope.model_input_errors.push('motor_type');
        }
        else {
            model.motor_type = JSON.parse(model.motor_type);
            model.motors = getMotors(model.motor_type, model.num_motors);
            model.real_motor_type = model.motor_type;
            model.motor_type = model.motor_type.name;
        }

        if ($scope.model_input_errors.length === 0) {
            model.inputs = $scope.getModelInputs(model.model_type);
            if (model.id === undefined || model.id == null) {
                model.id = next_model_id++;
                $scope.models_collapsed[model.id] = true;
            }

            if($scope.visible_models[model.id] === undefined || $scope.visible_models[model.id] === null) {
                $scope.visible_models[model.id] = ($scope.models.length < 5);
            }

            if($scope.temp_model_index !== undefined) {
                $scope.models[$scope.temp_model_index] = model;
            }
            else{
                $scope.models.push(model);
            }
            $scope.cancelModel();
            $scope.runSim();
        }
    };

    $scope.cancelModel = function () {
        $scope.temp_model = undefined;
        $scope.temp_model_type = undefined;
        $scope.temp_model_inputs = undefined;
        $scope.temp_model_index = undefined;
    };

    $scope.runSim = function () {
        var temp_series = [];
        simulator_data = {};
        simulators = {};
        $scope.element_titles = {};
        $scope.elements_can_plot = undefined;
        $scope.series = [];
        $scope.data = [];
        $scope.models.forEach(function(model){
            var sim = new Simulator(model.motors,
                model.gear_ratio,
                model.motor_current_limit,
                model.motor_peak_current_limit,
                model.motor_voltage_limit,
                model.effective_diameter,
                model.effective_mass,
                model.k_gearbox_efficiency,
                model.incline_angle,
                model.coeff_kinetic_friction,
                model.coeff_static_friction,
                model.k_resistance_s,
                model.k_resistance_v,
                model.battery_voltage,
                model.resistance_com,
                model.resistance_idv,
                model.time_step,
                model.simulation_time,
                model.max_dist);
            simulators[model.id] = sim;
            if ($scope.elements_can_plot === undefined) {
                var pnt = sim.getFinalPoint();
                $scope.elements_can_plot = Object.keys(pnt);
            }
            var data = {};
            for (var i in $scope.elements_can_plot) {
                var elem = $scope.elements_can_plot[i];
                data[elem] = [];
                $scope.scale_factors[elem] = 1;
                $scope.element_titles[elem] = elem.replaceAll('_', ' ').toProperCase();
            }
            sim.getDataPoints().forEach(function (pt) {
                for (var k in data) {
                    data[k].push({
                        x: pt.time,
                        y: pt[k]
                    });
                }
            });
            for (var k in data) {
                simulator_data[model.id] = data;
                temp_series.push({
                    label: model.name + " " + k,
                    key: k
                });
            }
        });
        temp_series.sort(function (a, b) {
            if (a['key'] > b['key']) return 1;
            else if (a['key'] < b['key']) return -1;
            else {
                if (a['label'] > b['label']) return 1;
                else if (a['label'] < b['label']) return -1;
                else return 0;
            }
        });
        temp_series.forEach(function (elem) {
            $scope.series.push(elem.label);
        });
        $scope.loadLines();
    };

    $scope.loadLines = function () {
        $scope.data = [];
        $scope.models.forEach(function(model){
            if($scope.visible_models[model.id]) {
                $scope.elements_can_plot.forEach(function (key) {
                    if ($scope.visible_elements[key]) {
                        var data = [];
                        simulator_data[model.id][key].forEach(function (pnt) {
                            pnt = angular.copy(pnt);
                            pnt.y = pnt.y / $scope.scale_factors[key];
                            data.push(pnt);
                        });
                        $scope.data.push(data);
                    }
                });
            }
        });
    };

    $scope.onClick = function (points, evt) {
        console.log(points, evt);
    };

    var simulators = {};
    var simulator_data = {};
    $scope.element_titles = {};
    $scope.series = [];
    $scope.data = [];
    $scope.datasetOverride = [];
    $scope.options = {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            yAxes: [{
                ticks: {
                    beginAtZero: true
                }
            }],
            xAxes: [{
                type: 'linear',
                ticks: {
                    min: 0,
                    stepSize: 0.01
                }
            }]
        }
    };


    $scope.runSim();
});